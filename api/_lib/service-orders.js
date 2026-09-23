/* Service-order domain helpers (T2).
   All mutating helpers accept a pg Client so the caller owns the transaction.
   This is the only place that:
   - generates order_number (via service_order_number_seq)
   - validates v2 quote lines
   - approves an offer's quote lines into service_order_lines
   - books a slot atomically
   - submits a service_completion + service_completion_lines
   - confirms a completion: writes history, resolves needs, schedules reminders,
     writes commission_entries (if terms allow)
   No business rule lives in handlers; they orchestrate transactions and
   delegate to these helpers. */

/* ── ID + money helpers ──────────────────────────────────────────────── */

export function generateOrderNumber(client, year = new Date().getFullYear()) {
  /* Postgres nextval is the only correct "monotonic id under concurrency"
     answer; COUNT+1 is explicitly forbidden by spec §5.2. We serialise by
     acquiring the row inside the caller transaction. */
  // Service: caller can wrap with SELECT nextval('service_order_number_seq')
  // in a single statement; this helper exists for readability.
}

export function nextOrderNumber(client, year) {
  return client.query("SELECT nextval('service_order_number_seq') AS n").then((r) => {
    const seq = String(r.rows[0].n).padStart(6, '0');
    return `KC-${year}-${seq}`;
  });
}

export function formatOrderNumber(year, seq) {
  return `KC-${year}-${String(seq).padStart(6, '0')}`;
}

/* ── Quote line validation (v2 schema §5.2) ──────────────────────────── */

const VALID_WORK_TYPES = ['inspect', 'replace', 'repair', 'service'];
const SERVICE_KEY_RE = /^[a-z][a-z0-9_]{0,99}$/;

export function validateQuoteLineV2(line, idx) {
  if (typeof line !== 'object' || line === null) throw new Error(`Line ${idx} not an object`);
  const description = String(line.description ?? '').trim();
  if (!description || description.length > 200) throw new Error(`Line ${idx}: description 1-200 chars`);
  const quantity = Number.isInteger(line.quantity) ? line.quantity : 1;
  if (quantity < 1 || quantity > 100) throw new Error(`Line ${idx}: quantity 1-100`);
  const partsUnit = Number.isInteger(line.parts_unit_minor) ? line.parts_unit_minor : 0;
  const labour = Number.isInteger(line.labour_minor) ? line.labour_minor : 0;
  if (partsUnit < 0 || partsUnit > 10000000) throw new Error(`Line ${idx}: parts_unit_minor invalid`);
  if (labour < 0 || labour > 10000000) throw new Error(`Line ${idx}: labour_minor invalid`);
  const workType = line.work_type;
  if (!VALID_WORK_TYPES.includes(workType)) throw new Error(`Line ${idx}: work_type invalid`);
  const keys = Array.isArray(line.service_keys) ? line.service_keys : [];
  if (keys.length > 30) throw new Error(`Line ${idx}: too many service_keys`);
  if (keys.some((k) => typeof k !== 'string' || !SERVICE_KEY_RE.test(k))) throw new Error(`Line ${idx}: invalid service_key`);
  const amountMinor = quantity * partsUnit + labour;
  return {
    line_id: line.line_id || null, // UUID; assigned by caller if missing
    description, quantity, parts_unit_minor: partsUnit, labour_minor: labour,
    work_type: workType, service_keys: [...new Set(keys)],
    parts_brand: line.parts_brand ?? null, parts_spec: line.parts_spec ?? null,
    part_number: line.part_number ?? null,
    amount_minor: amountMinor,
    warranty_text: typeof line.warranty_text === 'string' ? line.warranty_text.slice(0, 1000) : null,
  };
}

export function validateQuoteLinesV2(lines) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 30) throw new Error('Provide 1–30 quote lines');
  return lines.map(validateQuoteLineV2);
}

/* ── accept_quote: lock + version check + generate order lines ─────────── */

export async function acceptQuoteV2(client, { requestId, userId, quoteId, selectedLineIds }) {
  const r = (await client.query(
    `SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE`, [requestId]
  )).rows[0];
  if (!r) throw new Error('Request not found');
  if (r.user_id !== userId) throw new Error('Only the owner can accept a current quote');
  if (r.status !== 'quoted' && r.status !== 'accepted') throw new Error('Cannot accept in this status');
  const q = (await client.query(
    `SELECT * FROM dealer_quotes WHERE id=$1 AND request_id=$2`, [quoteId, requestId]
  )).rows[0];
  if (!q) throw new Error('Quote not found for this request');
  if (new Date(q.expires_at) <= new Date()) throw new Error('Quote has expired');
  // The quote must be the latest version. Any newer quote invalidates this one.
  const newer = await client.query(
    `SELECT 1 FROM dealer_quotes WHERE request_id=$1 AND version > $2 LIMIT 1`,
    [requestId, q.version]
  );
  if (newer.rowCount) throw new Error('A newer quote has been issued; refresh before accepting');
  // selected_line_ids must reference valid quote lines (by line_id).
  const items = Array.isArray(q.items) ? q.items : [];
  const byLineId = new Map(items.map((it) => [it.line_id, it]));
  if (!Array.isArray(selectedLineIds) || selectedLineIds.length === 0) {
    throw new Error('At least one quote line must be selected');
  }
  if (selectedLineIds.length > items.length) throw new Error('Too many line ids');
  const unique = new Set(selectedLineIds);
  if (unique.size !== selectedLineIds.length) throw new Error('Duplicate line ids');
  const approved = [];
  for (const lid of selectedLineIds) {
    const item = byLineId.get(lid);
    if (!item) throw new Error(`Unknown line_id ${lid}`);
    const validated = validateQuoteLineV2(item, approved.length);
    validated.line_id = item.line_id;
    approved.push(validated);
  }
  const totalMinor = approved.reduce((sum, l) => sum + l.amount_minor, 0);
  // Insert service_order_lines from the approved set. Skip lines that already
  // exist (idempotent retry).
  for (const line of approved) {
    const existing = await client.query(
      `SELECT 1 FROM service_order_lines WHERE request_id=$1 AND quote_id=$2 AND quote_line_id=$3`,
      [requestId, q.id, line.line_id]
    );
    if (existing.rowCount) continue;
    const idx = items.findIndex((it) => it.line_id === line.line_id);
    await client.query(
      `INSERT INTO service_order_lines
         (request_id,quote_id,quote_line_id,quote_line_index,description,service_keys,work_type,quantity,
          parts_brand,parts_spec,part_number,parts_unit_minor,labour_minor,amount_minor,
          warranty_text,approved_by,approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT DO NOTHING`,
      [requestId, q.id, line.line_id, idx >= 0 ? idx : 0, line.description, line.service_keys, line.work_type,
       line.quantity, line.parts_brand, line.parts_spec, line.part_number,
       line.parts_unit_minor, line.labour_minor, line.amount_minor, line.warranty_text, userId]
    );
  }
  // Update request: set accepted_quote_id, status=accepted, snapshot totals.
  await client.query(
    `UPDATE dealer_service_requests SET accepted_quote_id=$1, status='accepted',
       approved_total_minor=$2, currency=$3, version=version+1, updated_at=NOW()
       WHERE id=$4 AND version=$5`,
    [q.id, totalMinor, q.currency, requestId, r.version]
  );
  // Bump quote accepted_at (idempotent).
  await client.query(
    `UPDATE dealer_quotes SET accepted_at=COALESCE(accepted_at, NOW()) WHERE id=$1`,
    [q.id]
  );
  return { orderLines: approved, totalMinor, currency: q.currency };
}

/* ── reject_quote ─────────────────────────────────────────────────────── */

export async function rejectQuoteV2(client, { requestId, userId, quoteId, reason }) {
  const r = (await client.query(
    `SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE`, [requestId]
  )).rows[0];
  if (!r) throw new Error('Request not found');
  if (r.user_id !== userId) throw new Error('Only the owner can reject a quote');
  if (!['quoted', 'new'].includes(r.status)) throw new Error('Cannot reject in this status');
  const q = (await client.query(
    `SELECT 1 FROM dealer_quotes WHERE id=$1 AND request_id=$2`, [quoteId, requestId]
  )).rows[0];
  if (!q) throw new Error('Quote not found');
  // Status returns to new; no accepted_quote_id remains.
  await client.query(
    `UPDATE dealer_service_requests SET status='new', accepted_quote_id=NULL,
       version=version+1, updated_at=NOW() WHERE id=$1`,
    [requestId]
  );
  await client.query(
    `INSERT INTO dealer_request_events (request_id,actor_id,action,note) VALUES ($1,$2,$3,$4)`,
    [requestId, userId, 'reject_quote', reason || null]
  );
}

/* ── schedule: atomic booking with capacity check ─────────────────────── */

export async function scheduleSlotV2(client, { requestId, userId, slotId, operator = false }) {
  /* Lock the slot FOR UPDATE, count confirmed bookings, validate capacity,
     then insert a confirmed booking. Per spec §5.4: reschedule follows the
     same pattern with two locks ordered by slot id. */
  const slot = (await client.query(
    `SELECT bs.*, db.dealer_id FROM booking_slots bs
       JOIN dealer_branches db ON db.id=bs.branch_id
       WHERE bs.id=$1 FOR UPDATE`, [slotId]
  )).rows[0];
  if (!slot) throw new Error('Slot not found');
  if (!slot.active) throw new Error('Slot is no longer available');
  if (new Date(slot.starts_at) <= new Date()) throw new Error('Slot is in the past');
  const r = (await client.query(
    `SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE`, [requestId]
  )).rows[0];
  if (!r) throw new Error('Request not found');
  const isOwner = r.user_id === userId;
  const isMember = await client.query(
    `SELECT 1 FROM dealer_members WHERE dealer_id=$1 AND user_id=$2 AND role IN ('owner','manager','staff')`, [slot.dealer_id, userId]
  );
  const canSchedule = isOwner || (operator && isMember.rowCount);
  if (!canSchedule) throw new Error('Not allowed to schedule this request');
  if (!['accepted', 'scheduled', 'quoted'].includes(r.status)) throw new Error('Quote not yet accepted');
  const count = await client.query(
    `SELECT COUNT(*)::int AS n FROM service_bookings
       WHERE slot_id=$1 AND status='confirmed' AND request_id <> $2`,
    [slotId, requestId]
  );
  if (count.rows[0].n >= slot.capacity) throw new Error('Slot is full');
  // Cancel any prior confirmed booking on this request.
  await client.query(
    `UPDATE service_bookings SET status='cancelled', cancelled_at=NOW()
       WHERE request_id=$1 AND status='confirmed'`,
    [requestId]
  );
  await client.query(
    `INSERT INTO service_bookings (request_id, slot_id, status, booked_by)
       VALUES ($1, $2, 'confirmed', $3)`,
    [requestId, slotId, userId]
  );
  // Mirror scheduled_at for legacy UI
  await client.query(
    `UPDATE dealer_service_requests SET scheduled_at=$1, status='scheduled',
       version=version+1, updated_at=NOW() WHERE id=$2`,
    [slot.starts_at, requestId]
  );
  return { starts_at: slot.starts_at, ends_at: slot.ends_at };
}

/* ── start: operator marks work in progress ───────────────────────────── */

export async function startService(client, { requestId, userId }) {
  const r = (await client.query(
    `SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE`, [requestId]
  )).rows[0];
  if (!r) throw new Error('Request not found');
  if (r.status !== 'scheduled') throw new Error('Request must be scheduled before starting');
  await client.query(
    `UPDATE dealer_service_requests SET started_at=NOW(), work_state='in_progress',
       version=version+1, updated_at=NOW() WHERE id=$1`, [requestId]
  );
}

/* ── complete: operator submits a completion (already validated) ─────── */

export async function submitCompletion(client, { requestId, userId, completion }) {
  const r = (await client.query(
    `SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE`, [requestId]
  )).rows[0];
  if (!r) throw new Error('Request not found');
  if (r.status !== 'scheduled') throw new Error('Request must be scheduled before completion');
  if (r.work_state !== 'in_progress') throw new Error('Service must be started first');
  // Verify each completion line targets an approved line in this request.
  const orderLines = (await client.query(
    `SELECT * FROM service_order_lines WHERE request_id=$1`, [requestId]
  )).rows;
  const orderById = new Map(orderLines.map((l) => [l.id, l]));
  for (const line of completion.lines) {
    if (!orderById.has(line.order_line_id)) throw new Error(`Unknown order line ${line.order_line_id}`);
  }
  // Compute final total: only completed lines bill; not_performed don't.
  const completedSum = completion.lines
    .filter((l) => l.outcome === 'completed')
    .reduce((sum, l) => sum + (orderById.get(l.order_line_id)?.amount_minor || 0), 0);
  const revision = (await client.query(
    `SELECT COALESCE(MAX(revision),0)+1 AS n FROM service_completions WHERE request_id=$1`, [requestId]
  )).rows[0].n;
  await client.query(
    `INSERT INTO service_completions
       (request_id,revision,status,mileage_km,started_at,finished_at,duration_minutes,
        technician_name,notes,final_total_minor,submitted_by,submitted_at)
     VALUES ($1,$2,'submitted',$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`,
    [requestId, revision, completion.mileage_km, completion.started_at, completion.finished_at,
     completion.duration_minutes ?? null, completion.technician_name,
     completion.notes ?? null, completedSum, userId]
  );
  const completionId = (await client.query(
    `SELECT id FROM service_completions WHERE request_id=$1 AND revision=$2`, [requestId, revision]
  )).rows[0].id;
  for (const line of completion.lines) {
    await client.query(
      `INSERT INTO service_completion_lines
         (completion_id, order_line_id, outcome, actual_parts_brand, actual_parts_spec,
          actual_part_number, notes, next_due_km, next_due_date, not_performed_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [completionId, line.order_line_id, line.outcome, line.actual_parts_brand ?? null,
       line.actual_parts_spec ?? null, line.actual_part_number ?? null, line.notes ?? null,
       line.next_due_km ?? null, line.next_due_date ?? null,
       line.outcome === 'not_performed' ? (line.not_performed_reason ?? 'unspecified') : null]
    );
    // Update order line execution_state accordingly.
    await client.query(
      `UPDATE service_order_lines SET execution_state=$1,
         not_performed_reason = CASE WHEN $1 = 'not_performed' THEN $2 ELSE NULL END
         WHERE id=$3`,
      [line.outcome, line.not_performed_reason ?? null, line.order_line_id]
    );
  }
  await client.query(
    `UPDATE dealer_service_requests SET work_state='completion_submitted',
       completed_at=NOW(), final_total_minor=$1,
       version=version+1, updated_at=NOW() WHERE id=$2`,
    [completedSum, requestId]
  );
  return { completion_id: completionId, final_total_minor: completedSum };
}

/* ── confirm_completion: owner accepts → history + reminders + commission */

export async function confirmCompletionV2(client, { requestId, userId }) {
  const r = (await client.query(
    `SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE`, [requestId]
  )).rows[0];
  if (!r) throw new Error('Request not found');
  if (r.user_id !== userId) throw new Error('Only the owner can confirm completion');
  if (r.work_state !== 'completion_submitted') throw new Error('No completion pending confirmation');
  const completion = (await client.query(
    `SELECT * FROM service_completions WHERE request_id=$1 ORDER BY revision DESC LIMIT 1`, [requestId]
  )).rows[0];
  if (!completion) throw new Error('Completion record missing');
  if (completion.status !== 'submitted') throw new Error('Completion not in submitted status');
  // Pull completed (billed) order lines only.
  const completedLines = (await client.query(
    `SELECT cl.completion_id, cl.order_line_id, cl.outcome, cl.actual_parts_brand, cl.actual_parts_spec, cl.actual_part_number, cl.notes, cl.next_due_km, cl.next_due_date, cl.not_performed_reason, sol.* FROM service_completion_lines cl
       JOIN service_order_lines sol ON sol.id=cl.order_line_id
       WHERE cl.completion_id=$1 AND cl.outcome='completed'`, [completion.id]
  )).rows;
  // Insert a single history row per order line carrying the dealer's service_keys.
  // Spec §5.6: inspection lines do NOT clear last_done; maintenance lines do,
  // but the helper that writes history (createServiceRecordTx) recomputes
  // wear=0 based on the latest maintenance record. We split inspection out:
  const maintenanceKeys = completedLines
    .filter((l) => l.work_type !== 'inspect')
    .flatMap((l) => l.service_keys || []);
  const inspectionKeys = completedLines
    .filter((l) => l.work_type === 'inspect')
    .flatMap((l) => l.service_keys || []);
  if (maintenanceKeys.length) {
    await client.query(
      `INSERT INTO service_history
         (id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km, created_by_user_id,
          updated_by_user_id, source, dealer_id, branch_id, service_keys, request_id,
          completion_id, record_type, structured_total_minor, currency, version)
       VALUES (gen_random_uuid()::text, $1, $2, 'merchant_service', $3, $4, $5, $6, $7,
               $7, 'service_request', $8, $9, $10, $11, $12, 'maintenance', $13, $14, 1)`,
      [r.vehicle_id, completion.finished_at,
       `${r.service_kind || 'service'} 維修完成`,
       completion.notes || null,
       `${r.currency || 'MOP'} ${(completion.final_total_minor / 100).toFixed(2)}`,
       completion.mileage_km, userId, r.dealer_id, r.branch_id,
       [...new Set(maintenanceKeys)], r.id, completion.id,
       completion.final_total_minor, r.currency || 'MOP']
    );
    // Resolve needs for the keys actually maintained.
    await client.query(
      `UPDATE vehicle_needs SET state='resolved', updated_at=NOW()
         WHERE vehicle_id=$1 AND service_key=ANY($2::text[]) AND state <> 'resolved'`,
      [r.vehicle_id, [...new Set(maintenanceKeys)]]
    );
    // Update vehicle_status: recompute via latest history for each key.
    for (const key of [...new Set(maintenanceKeys)]) {
      const latest = (await client.query(
        `SELECT id, performed_at, mileage_km FROM service_history
           WHERE vehicle_id=$1 AND voided_at IS NULL AND service_keys @> ARRAY[$2]::text[]
           ORDER BY performed_at DESC, created_at DESC, id DESC LIMIT 1`,
        [r.vehicle_id, key]
      )).rows[0];
      if (latest) {
        await client.query(
          `UPDATE vehicle_status SET last_done_at=$1, last_done_km=$2, wear=0,
               last_service_history_id=$3, updated_by_user_id=$4, updated_by_dealer_id=$5,
               updated_at=NOW()
             WHERE vehicle_id=$6 AND service_item_type_key=$7`,
          [latest.performed_at, latest.mileage_km, latest.id, userId, r.dealer_id,
           r.vehicle_id, key]
        );
      }
    }
    // Update vehicle mileage.
    await client.query(
      `UPDATE vehicles SET mileage_km=GREATEST(mileage_km,$1),
           mileage_label=GREATEST(mileage_km,$1)::text || ' km',
           updated_at=NOW(), updated_by_user_id=$2 WHERE id=$3`,
      [completion.mileage_km, userId, r.vehicle_id]
    );
    // Schedule reminders from each completion line that has next_due_km/date.
    for (const line of completedLines) {
      if (line.outcome !== 'completed') continue;
      if (!line.next_due_km && !line.next_due_date) continue;
      for (const key of (line.service_keys || [])) {
        await client.query(
          `INSERT INTO reminders
             (id, vehicle_id, title, kind, due_in, service_key, due_at, due_mileage_km,
              status, source_completion_id, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'service', $7, $3, $4, $5, 'upcoming', $6, NOW())
           ON CONFLICT DO NOTHING`,
          [r.vehicle_id, `${key} 下次提醒`, key, line.next_due_date || null,
           line.next_due_km || null, completion.id,
           line.next_due_km ? `${line.next_due_km} km` : 'unknown']
        );
      }
    }
  }
  if (inspectionKeys.length && r.service_kind !== 'maintenance') {
    await client.query(
      `INSERT INTO service_history
         (id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km, created_by_user_id,
          updated_by_user_id, source, dealer_id, branch_id, service_keys, request_id,
          completion_id, record_type, currency, version)
       VALUES (gen_random_uuid()::text, $1, $2, 'inspection', $3, $4, NULL, $5, $6,
               $6, 'service_request', $7, $8, $9, $10, $11, 'inspection', $12, 1)`,
      [r.vehicle_id, completion.finished_at,
       '檢查完成', completion.notes || null,
       completion.mileage_km, userId, r.dealer_id, r.branch_id,
       [...new Set(inspectionKeys)], r.id, completion.id, r.currency || 'MOP']
    );
  }
  // Commission: find active commercial terms for this dealer; if origin is
  // platform_new and a non-zero rate is in force, accrue. Unknown origin is
  // deferred. dealer_existing is 0 by spec §5.8.
  await writeCommissionEntry(client, { requestId, completionId: completion.id,
    dealerId: r.dealer_id, origin: r.customer_origin || 'unknown',
    basisMinor: completion.final_total_minor });
  // Mark completion + request confirmed.
  await client.query(
    `UPDATE service_completions SET status='confirmed', confirmed_by=$1, confirmed_at=NOW(),
       version=version+1, updated_at=NOW() WHERE id=$2`,
    [userId, completion.id]
  );
  await client.query(
    `UPDATE dealer_service_requests SET work_state=NULL, status='completed',
       completion_confirmed_at=NOW(), version=version+1, updated_at=NOW() WHERE id=$1`,
    [requestId]
  );
}

async function writeCommissionEntry(client, { requestId, completionId, dealerId, origin, basisMinor }) {
  const terms = (await client.query(
    `SELECT * FROM dealer_commercial_terms
       WHERE dealer_id=$1 AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
       ORDER BY starts_at DESC LIMIT 1`, [dealerId]
  )).rows[0];
  // 0 bps by default if no terms row, or if origin is dealer_existing.
  let rateBps = 0;
  let termsId = null;
  if (origin !== 'dealer_existing' && terms) {
    rateBps = terms.commission_bps || 0;
    termsId = terms.id;
  }
  // unknown origin: do not accrue; freeze until admin rules.
  if (origin === 'unknown') return;
  if (rateBps === 0) return;
  // Integer math: basis × bps / 10000, rounded.
  const feeMinor = Math.floor((basisMinor * rateBps) / 10000);
  if (feeMinor <= 0) return;
  await client.query(
    `INSERT INTO commission_entries
       (request_id, completion_id, dealer_id, terms_id, origin, basis_minor,
        rate_bps, commission_minor, entry_type, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'accrual','pending')`,
    [requestId, completionId, dealerId, termsId, origin, basisMinor, rateBps, feeMinor]
  );
}