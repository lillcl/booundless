import { randomUUID } from 'node:crypto';

const SOURCES = new Set(['owner_manual', 'owner_ai_assisted', 'dealer', 'service_request']);

function clean(value, max = 1000) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, max) : null;
}

export function normalizeServiceRecord(body, source = 'owner_manual') {
  const title = clean(body?.title, 180);
  if (!title) throw new Error('請輸入保養紀錄名稱');
  const performedAt = new Date(body?.performed_at || Date.now());
  if (Number.isNaN(performedAt.getTime())) throw new Error('保養日期無效');
  const mileage = body?.mileage_km === '' || body?.mileage_km == null
    ? null : Number(body.mileage_km);
  if (mileage != null && (!Number.isInteger(mileage) || mileage < 0 || mileage > 10000000)) {
    throw new Error('里程必須是有效的公里數');
  }
  const keys = [...new Set((Array.isArray(body?.service_keys) ? body.service_keys : [])
    .map((value) => clean(value, 100)).filter(Boolean))];
  if (keys.length > 30) throw new Error('每筆紀錄最多選擇 30 個保養項目');
  return {
    title,
    performedAt,
    mileage,
    kind: clean(body?.kind, 80) || 'maintenance',
    notes: clean(body?.notes, 3000),
    cost: clean(body?.cost, 80),
    serviceKeys: keys,
    source: SOURCES.has(source) ? source : 'owner_manual',
  };
}

async function validateKeys(client, vehicleId, keys) {
  if (!keys.length) return;
  const valid = await client.query(
    `SELECT DISTINCT service_item_type_key FROM vehicle_status
      WHERE vehicle_id=$1 AND service_item_type_key=ANY($2::text[])`,
    [vehicleId, keys],
  );
  if (valid.rowCount !== keys.length) throw new Error('包含不屬於這輛車的保養項目');
}

async function recomputeStatus(client, vehicleId, keys, actor) {
  for (const key of [...new Set(keys)]) {
    const latest = await client.query(
      `SELECT id, performed_at, mileage_km, created_by_user_id, dealer_id
         FROM service_history
        WHERE vehicle_id=$1 AND voided_at IS NULL AND service_keys @> ARRAY[$2]::text[]
        ORDER BY performed_at DESC, created_at DESC, id DESC LIMIT 1`,
      [vehicleId, key],
    );
    if (latest.rowCount) {
      const row = latest.rows[0];
      await client.query(
        `UPDATE vehicle_status
            SET last_done_at=$1,last_done_km=$2,wear=0,last_service_history_id=$3,
                updated_by_user_id=$4,updated_by_dealer_id=$5,updated_at=NOW()
          WHERE vehicle_id=$6 AND service_item_type_key=$7`,
        [row.performed_at, row.mileage_km, row.id, actor.userId, actor.dealerId, vehicleId, key],
      );
    } else {
      await client.query(
        `UPDATE vehicle_status
            SET last_done_at=NULL,last_done_km=NULL,wear=0,last_service_history_id=NULL,
                updated_by_user_id=$1,updated_by_dealer_id=$2,updated_at=NOW()
          WHERE vehicle_id=$3 AND service_item_type_key=$4 AND last_service_history_id IS NOT NULL`,
        [actor.userId, actor.dealerId, vehicleId, key],
      );
    }
  }
}

export async function createServiceRecord(db, { vehicleId, userId, dealerId = null, branchId = null, body, source }) {
  const record = normalizeServiceRecord(body, source);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await validateKeys(client, vehicleId, record.serviceKeys);
    const id = `history-${randomUUID()}`;
    const inserted = await client.query(
      `INSERT INTO service_history
        (id,vehicle_id,performed_at,kind,title,notes,cost,mileage_km,created_by_user_id,
         updated_by_user_id,source,dealer_id,branch_id,service_keys)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13)
       RETURNING *`,
      [id, vehicleId, record.performedAt, record.kind, record.title, record.notes,
       record.cost, record.mileage, userId, record.source, dealerId, branchId, record.serviceKeys],
    );
    await recomputeStatus(client, vehicleId, record.serviceKeys, { userId, dealerId });
    if (record.mileage != null) {
      await client.query(
        `UPDATE vehicles SET mileage_km=GREATEST(mileage_km,$1),mileage_label=GREATEST(mileage_km,$1)::text || ' km',updated_at=NOW(),updated_by_user_id=$2 WHERE id=$3`,
        [record.mileage, userId, vehicleId],
      );
    }
    if (record.serviceKeys.length) {
      await client.query(
        `UPDATE vehicle_needs SET state='resolved',updated_at=NOW()
          WHERE vehicle_id=$1 AND service_key=ANY($2::text[]) AND state <> 'resolved'`,
        [vehicleId, record.serviceKeys],
      );
    }
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateServiceRecord(db, { vehicleId, recordId, userId, dealerId = null, body, owner = false }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM service_history WHERE id=$1 AND vehicle_id=$2 AND voided_at IS NULL FOR UPDATE`,
      [recordId, vehicleId],
    );
    if (!existing.rowCount) throw Object.assign(new Error('找不到保養紀錄'), { status: 404 });
    const previous = existing.rows[0];
    if (!owner && previous.dealer_id !== dealerId) {
      throw Object.assign(new Error('車商只能修改自己為這輛車建立的紀錄'), { status: 403 });
    }
    if (body?.version != null && Number(body.version) !== Number(previous.version)) {
      throw Object.assign(new Error('紀錄已被更新，請重新載入'), { status: 409 });
    }
    const record = normalizeServiceRecord({ ...previous, ...body }, previous.source);
    await validateKeys(client, vehicleId, record.serviceKeys);
    const updated = await client.query(
      `UPDATE service_history SET performed_at=$1,kind=$2,title=$3,notes=$4,cost=$5,mileage_km=$6,
          service_keys=$7,updated_by_user_id=$8,version=version+1,updated_at=NOW()
        WHERE id=$9 AND vehicle_id=$10 RETURNING *`,
      [record.performedAt, record.kind, record.title, record.notes, record.cost, record.mileage,
       record.serviceKeys, userId, recordId, vehicleId],
    );
    await recomputeStatus(client, vehicleId,
      [...new Set([...(previous.service_keys || []), ...record.serviceKeys])], { userId, dealerId });
    if (record.mileage != null) {
      await client.query(
        `UPDATE vehicles SET mileage_km=GREATEST(mileage_km,$1),mileage_label=GREATEST(mileage_km,$1)::text || ' km',updated_at=NOW(),updated_by_user_id=$2 WHERE id=$3`,
        [record.mileage, userId, vehicleId],
      );
    }
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
