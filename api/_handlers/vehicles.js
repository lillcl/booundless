/* GET /api/vehicles — list vehicles.
   GET /api/vehicles/:id — fetch a single vehicle.
   GET /api/vehicles/:id/status — full maintenance status for one vehicle.
   POST /api/vehicles/:id/scope/generate — backfill missing vehicle_status rows. */
import { getDb } from '../_lib/db.js';
import { randomUUID } from 'node:crypto';
import { requireUser } from '../_lib/auth.js';
import { readBody, sendError, sendJSON, onlyMethod } from '../_lib/http.js';
import { defaultScopeRows } from '../_lib/scope-template.js';
import { suggestExtraScope, fingerprint as scopeFingerprint } from '../_lib/scope-ai.js';

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
  const aiRows = await suggestExtraScope(vehicle);
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

  const r = await db.query(
    `SELECT id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km
     FROM service_history
     WHERE vehicle_id = $1
     ORDER BY performed_at DESC`,
    [id],
  );
  sendJSON(res, 200, { data: r.rows, count: r.rowCount });
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
  if (!onlyMethod(req, res, ['GET', 'POST'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const url = req.url || '';
    const historyMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/history\/?$/);
    if (historyMatch) return await handleHistory(req, res, decodeURIComponent(historyMatch[1]), user);

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

    if (url.startsWith('/api/vehicles')) {
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
    sendError(res, 500, 'internal_error', err.message);
  }
}
