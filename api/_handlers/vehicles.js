/* GET /api/vehicles — list vehicles.
   GET /api/vehicles/:id — fetch a single vehicle.
   GET /api/vehicles/:id/status — full maintenance status for one vehicle.
   POST /api/vehicles/:id/scope/generate — backfill missing vehicle_status rows. */
import { getDb } from '../_lib/db.js';
import { randomUUID } from 'node:crypto';
import { audit, requireUser } from '../_lib/auth.js';
import { readBody, sendError, sendJSON, onlyMethod } from '../_lib/http.js';
import { defaultScopeRows } from '../_lib/scope-template.js';
import { suggestExtraScope, fingerprint as scopeFingerprint } from '../_lib/scope-ai.js';
import { createServiceRecord, updateServiceRecord } from '../_lib/service-records.js';

async function handleStatus(req, res, id, user) {
  const db = await getDb();
  const v = await db.query(
    `SELECT id, model, make, year, fuel_type
     FROM vehicles WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL`,
    [id, user.id],
  );
  if (v.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);

  const r = await db.query(
    `SELECT id, item, service_item_type_key, interval_km, interval_months, last_done_km,
            last_done_at, wear, display_order, source
     FROM vehicle_status
     WHERE vehicle_id = $1
     ORDER BY display_order ASC, id ASC`,
    [id],
  );
  const attention = r.rows.filter((i) => i.wear >= 80).map((i) => i.item);
  /* data_complete is true only when every scope row has both last_done_km and
     last_done_at filled in. Until that happens the client must not claim the
     vehicle is in good condition — we have no inspection or service evidence. */
  const dataComplete = r.rows.length > 0 && r.rows.every(
    (i) => i.last_done_km != null && i.last_done_at != null,
  );
  const row = v.rows[0];
  sendJSON(res, 200, {
    vehicle: {
      id: row.id,
      model: row.model,
      make: row.make,
      year: row.year,
      fuel_type: row.fuel_type,
    },
    items: r.rows,
    attention_count: attention.length,
    attention,
    data_complete: dataComplete,
  });
}

async function handleScopeGenerate(req, res, id, user) {
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  const options = await readBody(req).catch(() => ({}));
  const db = await getDb();
  const v = await db.query(
    `SELECT id, model, make, year, fuel_type, vehicle_class, powertrain_type, mileage_km
     FROM vehicles WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL`,
    [id, user.id],
  );
  if (v.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);
  const vehicle = v.rows[0];

  const existing = await db.query(
    `SELECT service_item_type_key, item FROM vehicle_status WHERE vehicle_id = $1`,
    [id],
  );
  const existingKeys = new Set(
    existing.rows.map((r) => r.service_item_type_key).filter(Boolean),
  );
  /* Label-keyed dedupe tracks both the raw label and its fingerprint so
     re-runs reject synonymous AI rephrasings (DPF 檢查 vs DPF 強制再生,
     燃油濾清器 vs 燃油濾芯). Fingerprint=... entries catch the cases where
     the AI varies word order or swaps near-synonym tokens. */
  const existingLabelKeys = new Set(
    existing.rows.flatMap((r) => {
      const label = String(r.item || '').trim().toLowerCase();
      if (!label) return [];
      const fp = scopeFingerprint(r.item);
      return fp ? [`label:${label}`, `fp:${fp}`] : [`label:${label}`];
    }),
  );

  const orderRow = (await db.query(
    `SELECT COALESCE(MAX(display_order), 0)::int AS max_order
     FROM vehicle_status WHERE vehicle_id = $1`,
    [id],
  )).rows[0];
  let nextOrder = orderRow.max_order;

  const template = defaultScopeRows(vehicle);
  const inserted = [];
  for (const row of template) {
    if (existingKeys.has(row.service_item_type_key)) continue;
    nextOrder += 1;
    await db.query(
      `INSERT INTO vehicle_status
         (vehicle_id, item, service_item_type_key, interval_km, interval_months,
          last_done_km, last_done_at, wear, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [row.vehicle_id, row.item, row.service_item_type_key, row.interval_km,
       row.interval_months, row.last_done_km, row.last_done_at, row.wear,
       row.display_order + nextOrder - 1],
    );
    existingKeys.add(row.service_item_type_key);
    if (row.item) {
      const label = String(row.item).trim().toLowerCase();
      existingLabelKeys.add(`label:${label}`);
      const fp = scopeFingerprint(row.item);
      if (fp) existingLabelKeys.add(`fp:${fp}`);
    }
    inserted.push(row.service_item_type_key);
  }

  /* AI extension: model-specific items beyond the template (DPF, timing
     belt, transfer case, AdBlue, EV battery thermal checks, etc.). Failures
     never block — the helper returns [] on any error and logs the reason. */
  /* Passport rendering requests the deterministic DB template first so an
     empty book never waits on an external model. Full generation still adds
     model-specific AI rows when called without template_only=1. */
  const templateOnly = options?.template_only === true;
  const aiRows = templateOnly ? [] : await suggestExtraScope(vehicle);
  for (const row of aiRows) {
    const labelKey = `label:${String(row.item || '').trim().toLowerCase()}`;
    const fpKey = `fp:${scopeFingerprint(row.item)}`;
    if (row.service_item_type_key && existingKeys.has(row.service_item_type_key)) continue;
    if (!row.service_item_type_key && (existingLabelKeys.has(labelKey) || existingLabelKeys.has(fpKey))) continue;
    nextOrder += 1;
    await db.query(
      `INSERT INTO vehicle_status
         (vehicle_id, item, service_item_type_key, interval_km, interval_months,
          last_done_km, last_done_at, wear, display_order, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ai')`,
      [id, row.item, row.service_item_type_key, row.interval_km,
       row.interval_months, null, null, 0, nextOrder],
    );
    if (row.service_item_type_key) existingKeys.add(row.service_item_type_key);
    existingLabelKeys.add(labelKey);
    if (fpKey) existingLabelKeys.add(fpKey);
    inserted.push(`ai:${row.service_item_type_key || row.item}`);
  }

  const refreshed = await db.query(
    `SELECT id, item, service_item_type_key, interval_km, interval_months,
            last_done_km, last_done_at, wear, display_order, source
     FROM vehicle_status WHERE vehicle_id = $1
     ORDER BY display_order ASC, id ASC`,
    [id],
  );
  const attention = refreshed.rows.filter((i) => i.wear >= 80).map((i) => i.item);
  return sendJSON(res, 200, {
    vehicle: {
      id: vehicle.id, model: vehicle.model, make: vehicle.make,
      year: vehicle.year, fuel_type: vehicle.fuel_type,
    },
    items: refreshed.rows,
    attention_count: attention.length,
    attention,
    inserted,
  });
}

async function handleHistory(req, res, id, user) {
  const db = await getDb();
  const v = await db.query('SELECT id FROM vehicles WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL', [id, user.id]);
  if (v.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);

  if (req.method === 'POST') {
    const body = await readBody(req);
    try {
      const record = await createServiceRecord(db, {
        vehicleId: id, userId: user.id, body, source: 'owner_manual',
      });
      await audit({ actor: user, action: 'vehicle.history.create', targetType: 'service_history',
        targetId: record.id, payload: { vehicle_id: id, service_keys: record.service_keys }, req });
      return sendJSON(res, 201, { record });
    } catch (error) {
      return sendError(res, error.status || 422, 'unprocessable', error.message);
    }
  }
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Use GET or POST');

  const r = await db.query(
    `SELECT id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km,
            source,dealer_id,branch_id,service_keys,version,created_at,updated_at
     FROM service_history
     WHERE vehicle_id = $1 AND voided_at IS NULL
     ORDER BY performed_at DESC, created_at DESC`,
    [id],
  );
  sendJSON(res, 200, { data: r.rows, count: r.rowCount });
}

async function handleHistoryRecord(req, res, vehicleId, recordId, user) {
  if (req.method !== 'PATCH') return sendError(res, 405, 'method_not_allowed', 'Only PATCH allowed');
  const db = await getDb();
  const owned = await db.query(
    'SELECT id FROM vehicles WHERE id=$1 AND created_by_user_id=$2 AND archived_at IS NULL',
    [vehicleId, user.id],
  );
  if (!owned.rowCount) return sendError(res, 404, 'not_found', 'Vehicle not found');
  try {
    const record = await updateServiceRecord(db, {
      vehicleId, recordId, userId: user.id, body: await readBody(req), owner: true,
    });
    await audit({ actor: user, action: 'vehicle.history.update', targetType: 'service_history',
      targetId: record.id, payload: { vehicle_id: vehicleId, version: record.version }, req });
    return sendJSON(res, 200, { record });
  } catch (error) {
    return sendError(res, error.status || 422, error.status === 409 ? 'conflict' : 'unprocessable', error.message);
  }
}

async function handleDealerAccess(req, res, vehicleId, grantId, user) {
  const db = await getDb();
  const owned = await db.query(
    'SELECT id FROM vehicles WHERE id=$1 AND created_by_user_id=$2 AND archived_at IS NULL',
    [vehicleId, user.id],
  );
  if (!owned.rowCount) return sendError(res, 404, 'not_found', 'Vehicle not found');

  if (req.method === 'GET' && !grantId) {
    const grants = await db.query(
      `SELECT g.id,g.vehicle_id,g.dealer_id,d.display_name AS dealer_name,g.can_view_vehicle,
              g.can_manage_service_records,g.can_update_maintenance_status,g.granted_at,g.expires_at,g.revoked_at
         FROM vehicle_dealer_grants g JOIN dealers d ON d.id=g.dealer_id
        WHERE g.vehicle_id=$1 AND g.revoked_at IS NULL
        ORDER BY d.display_name`,
      [vehicleId],
    );
    return sendJSON(res, 200, { data: grants.rows });
  }
  if (req.method === 'POST' && !grantId) {
    const body = await readBody(req);
    const dealerId = String(body?.dealer_id || '').trim();
    if (!dealerId) return sendError(res, 422, 'unprocessable', '請選擇車商');
    const dealer = await db.query("SELECT id FROM dealers WHERE id=$1 AND status='active'", [dealerId]);
    if (!dealer.rowCount) return sendError(res, 404, 'not_found', '找不到可用車商');
    const expiresAt = body?.expires_at ? new Date(body.expires_at) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return sendError(res, 422, 'unprocessable', '到期日期無效');
    const result = await db.query(
      `INSERT INTO vehicle_dealer_grants
        (id,vehicle_id,dealer_id,granted_by_user_id,can_view_vehicle,can_manage_service_records,
         can_update_maintenance_status,granted_at,expires_at,revoked_at,updated_at)
       VALUES($1,$2,$3,$4,TRUE,$5,$6,NOW(),$7,NULL,NOW())
       ON CONFLICT(vehicle_id,dealer_id) DO UPDATE SET
         granted_by_user_id=EXCLUDED.granted_by_user_id,can_view_vehicle=TRUE,
         can_manage_service_records=EXCLUDED.can_manage_service_records,
         can_update_maintenance_status=EXCLUDED.can_update_maintenance_status,
         granted_at=NOW(),expires_at=EXCLUDED.expires_at,revoked_at=NULL,updated_at=NOW()
       RETURNING *`,
      [`grant-${randomUUID()}`, vehicleId, dealerId, user.id,
       body?.can_manage_service_records !== false, body?.can_update_maintenance_status !== false,
       expiresAt],
    );
    await audit({ actor: user, action: 'vehicle.dealer_access.grant', targetType: 'vehicle', targetId: vehicleId,
      payload: { dealer_id: dealerId, grant_id: result.rows[0].id }, req });
    return sendJSON(res, 201, { grant: result.rows[0] });
  }
  if (req.method === 'DELETE' && grantId) {
    const result = await db.query(
      `UPDATE vehicle_dealer_grants SET revoked_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND vehicle_id=$2 AND revoked_at IS NULL RETURNING id,dealer_id`,
      [grantId, vehicleId],
    );
    if (!result.rowCount) return sendError(res, 404, 'not_found', '找不到有效授權');
    await audit({ actor: user, action: 'vehicle.dealer_access.revoke', targetType: 'vehicle', targetId: vehicleId,
      payload: { dealer_id: result.rows[0].dealer_id, grant_id: grantId }, req });
    return sendJSON(res, 200, { ok: true });
  }
  return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
}

async function handleOnboarding(req, res, id, user) {
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  const body = await readBody(req);
  const next = String(body?.state || '');
  if (!['history_pending', 'baseline_pending', 'ready'].includes(next)) return sendError(res, 422, 'unprocessable', 'Invalid onboarding state');
  const db = await getDb();
  const r = await db.query(
    `UPDATE vehicles
     SET onboarding_state=$1, onboarding_completed_at=NOW(), updated_at=NOW(), updated_by_user_id=$2
     WHERE id=$3 AND created_by_user_id=$2 AND archived_at IS NULL
     RETURNING id, model, onboarding_state, onboarding_completed_at`,
    [next, user.id, id],
  );
  if (!r.rowCount) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);
  return sendJSON(res, 200, { vehicle: r.rows[0] });
}

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const url = req.url || '';
    const historyRecordMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/history\/([^/?#]+)\/?(?:\?.*)?$/);
    if (historyRecordMatch) return await handleHistoryRecord(req, res,
      decodeURIComponent(historyRecordMatch[1]), decodeURIComponent(historyRecordMatch[2]), user);

    const historyMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/history\/?$/);
    if (historyMatch) return await handleHistory(req, res, decodeURIComponent(historyMatch[1]), user);

    const accessRecordMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/dealer-access\/([^/?#]+)\/?(?:\?.*)?$/);
    if (accessRecordMatch) return await handleDealerAccess(req, res,
      decodeURIComponent(accessRecordMatch[1]), decodeURIComponent(accessRecordMatch[2]), user);
    const accessMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/dealer-access\/?(?:\?.*)?$/);
    if (accessMatch) return await handleDealerAccess(req, res, decodeURIComponent(accessMatch[1]), null, user);

    const onboardingMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/onboarding\/?$/);
    if (onboardingMatch) return await handleOnboarding(req, res, decodeURIComponent(onboardingMatch[1]), user);

    const statusMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/status\/?$/);
    if (statusMatch) return await handleStatus(req, res, decodeURIComponent(statusMatch[1]), user);

    const scopeGenerateMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/scope\/generate\/?$/);
    if (scopeGenerateMatch) return await handleScopeGenerate(req, res, decodeURIComponent(scopeGenerateMatch[1]), user);

    const idMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/?$/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const db = await getDb();
      if (req.method === 'PATCH') {
        const body = await readBody(req, { limit: '8mb' });
        const allowed = ['model', 'make', 'year', 'fuel_type', 'vehicle_class', 'powertrain_type', 'vin', 'plate', 'mileage_km', 'image'];
        const updates = [];
        const values = [];
        for (const field of allowed) {
          if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue;
          let value = body[field];
          if (field === 'model' && !String(value || '').trim()) return sendError(res, 422, 'unprocessable', 'model is required');
          if (field === 'mileage_km') value = Math.max(0, Number(value) || 0);
          if (field === 'year') value = value === '' || value == null ? null : Number(value);
          if (!['mileage_km', 'year'].includes(field)) value = String(value || '').trim() || null;
          values.push(value);
          updates.push(`${field}=$${values.length}`);
          if (field === 'mileage_km') {
            values.push(`${Number(value).toLocaleString()} km`);
            updates.push(`mileage_label=$${values.length}`);
          }
        }
        if (!updates.length) return sendError(res, 422, 'unprocessable', 'No editable fields supplied');
        values.push(user.id, id);
        const updated = await db.query(
          `UPDATE vehicles SET ${updates.join(', ')}, updated_by_user_id=$${values.length - 1}, updated_at=NOW()
           WHERE id=$${values.length} AND created_by_user_id=$${values.length - 1} AND archived_at IS NULL
           RETURNING id, model, make, year, fuel_type, vehicle_class, powertrain_type,
             onboarding_state, onboarding_completed_at, vin, plate, mileage_km, mileage_label,
             image, owner, team, created_at, updated_at`,
          values,
        );
        if (!updated.rowCount) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);
        return sendJSON(res, 200, updated.rows[0]);
      }
      if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Only GET or PATCH allowed');
      const r = await db.query(
        `SELECT id, model, make, year, fuel_type, vehicle_class, powertrain_type, onboarding_state, onboarding_completed_at, vin, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at
         FROM vehicles WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL`,
        [id, user.id],
      );
      if (r.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);
      return sendJSON(res, 200, r.rows[0]);
    }

    if (url.startsWith('/api/vehicles') && req.method === 'POST') {
      const db = await getDb();
      const body = await readBody(req);
      if (!body?.model) return sendError(res, 422, 'unprocessable', 'model is required');
      const id = randomUUID();
      const mileage = Math.max(0, Number(body.mileage_km) || 0);
      const r = await db.query(`INSERT INTO vehicles
        (id,model,make,year,fuel_type,vehicle_class,powertrain_type,onboarding_state,plate,mileage_km,mileage_label,image,owner,team,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'identity_confirmed',$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
      [id,body.model,body.make||null,body.year||null,body.fuel_type||null,body.vehicle_class||null,body.powertrain_type||null,body.plate||null,mileage,`${mileage.toLocaleString()} km`,body.image||'/assets/vehicle-placeholder.svg',user.display_name||user.email,body.team||'personal',user.id]);
      const vehicle = r.rows[0];

      /* Seed a default maintenance scope from the powertrain template so the
         detail page renders real items immediately and the AI fallback is only
         needed for edge cases. */
      const scopeTemplate = defaultScopeRows({ ...vehicle, mileage_km: mileage });
      for (const row of scopeTemplate) {
        await db.query(
          `INSERT INTO vehicle_status
             (vehicle_id, item, service_item_type_key, interval_km, interval_months,
              last_done_km, last_done_at, wear, display_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [row.vehicle_id, row.item, row.service_item_type_key, row.interval_km,
           row.interval_months, row.last_done_km, row.last_done_at, row.wear,
           row.display_order],
        );
      }

      /* AI extension: model-specific items beyond the template. Failures are
         absorbed by suggestExtraScope itself; the defensive try/catch here
         protects against any DB-level failure so the vehicle row is always
         returned to the client. */
      try {
        const aiRows = await suggestExtraScope({ ...vehicle, mileage_km: mileage });
        for (let i = 0; i < aiRows.length; i += 1) {
          const row = aiRows[i];
          await db.query(
            `INSERT INTO vehicle_status
               (vehicle_id, item, service_item_type_key, interval_km, interval_months,
                last_done_km, last_done_at, wear, display_order, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ai')`,
            [vehicle.id, row.item, row.service_item_type_key, row.interval_km,
             row.interval_months, null, null, 0, scopeTemplate.length + i + 1],
          );
        }
      } catch (e) {
        console.warn('[scope-ai] vehicle create insert skipped for', vehicle.id, e && e.message);
      }

      return sendJSON(res, 201, vehicle);
    }

    if (url.startsWith('/api/vehicles') && req.method === 'GET') {
      const db = await getDb();
      /* scope_confirmed follows the same rule as data_complete (every scope row
         has last_done_km AND last_done_at) AND the owner has explicitly
         completed onboarding (onboarding_state='ready'). Until then the
         client must not claim the vehicle is verified. */
      const r = await db.query(
        `SELECT v.id, v.model, v.make, v.year, v.fuel_type, v.vehicle_class, v.powertrain_type,
                v.onboarding_state, v.onboarding_completed_at, v.vin, v.plate,
                v.mileage_km, v.mileage_label, v.image, v.owner, v.team,
                v.created_at, v.updated_at,
                (v.onboarding_state = 'ready'
                 AND NOT EXISTS (
                   SELECT 1 FROM vehicle_status vs
                   WHERE vs.vehicle_id = v.id
                     AND (vs.last_done_km IS NULL OR vs.last_done_at IS NULL)
                 )) AS scope_confirmed
         FROM vehicles v
         WHERE v.created_by_user_id = $1 AND v.archived_at IS NULL
         ORDER BY v.created_at ASC`,
        [user.id]);
      return sendJSON(res, 200, { data: r.rows, count: r.rowCount });
    }

    sendError(res, 404, 'not_found', `No route matches ${url}`);
  } catch (err) {
    sendError(res, err.status || 500, 'internal_error', err.message);
  }
}
