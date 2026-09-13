import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '../_lib/db.js';
import { audit, requireAdmin, requireUser } from '../_lib/auth.js';
import { getOwnedVehicle } from '../_lib/tool-utils.js';
import { calculateDealerMatches, rankBranches } from '../_lib/dealer-matcher.js';
import { readBody, sendError, sendJSON } from '../_lib/http.js';

const DEALER_ROLES = new Set(['owner', 'manager', 'staff', 'viewer']);
const EDIT_ROLES = new Set(['owner', 'manager']);
const REQUEST_STATUSES = new Set(['new', 'accepted', 'scheduled', 'completed', 'cancelled']);

function pathInfo(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  return { pathname: url.pathname.replace(/\/+$/, '') || '/', query: url.searchParams };
}

function text(value, fallback = null, max = 500) {
  if (value == null || value === '') return fallback;
  const result = String(value).trim();
  return result ? result.slice(0, max) : fallback;
}

function id(value, name = 'id') {
  const result = text(value, null, 120);
  if (!result || !/^[\w:.\-]+$/.test(result)) throw new Error(`${name} is invalid`);
  return result;
}

function email(value) {
  const result = text(value, null, 240)?.toLowerCase();
  if (!result || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error('Valid email required');
  return result;
}

function dealerIdFromBodyOrQuery(body, query) {
  return id(body?.dealer_id || query.get('dealer_id'), 'dealer_id');
}

async function getDealer(db, dealerId) {
  const r = await db.query('SELECT * FROM dealers WHERE id = $1', [dealerId]);
  if (!r.rowCount) throw new Error('Dealer not found');
  return r.rows[0];
}

async function getMember(db, dealerId, userId) {
  const r = await db.query(
    `SELECT dm.dealer_id, dm.user_id, dm.role, d.display_name, d.status
       FROM dealer_members dm JOIN dealers d ON d.id = dm.dealer_id
      WHERE dm.dealer_id = $1 AND dm.user_id = $2`,
    [dealerId, userId],
  );
  return r.rows[0] || null;
}

async function requireDealerMember(req, res, dealerId, roles = []) {
  const user = await requireUser(req, res);
  if (!user) return null;
  const db = await getDb();
  const member = await getMember(db, dealerId, user.id);
  if (!member || member.status !== 'active' || (roles.length && !roles.includes(member.role))) {
    sendError(res, 403, 'forbidden', 'Dealer access denied');
    return null;
  }
  return { user, member, db };
}

async function resolveDealerForUser(req, res, db, user) {
  const { query } = pathInfo(req);
  const requested = query.get('dealer_id');
  if (requested) {
    const member = await getMember(db, requested, user.id);
    if (!member || member.status !== 'active') throw new Error('Dealer access denied');
    return requested;
  }
  const r = await db.query(
    `SELECT dm.dealer_id FROM dealer_members dm JOIN dealers d ON d.id = dm.dealer_id
      WHERE dm.user_id = $1 AND dm.role IN ('owner','manager','staff','viewer') AND d.status = 'active'
      ORDER BY d.display_name LIMIT 1`,
    [user.id],
  );
  if (!r.rowCount) throw new Error('No dealer membership found');
  return r.rows[0].dealer_id;
}

async function listAdminDealers(res) {
  const db = await getDb();
  const r = await db.query(`
    SELECT d.*,
      (SELECT COUNT(*)::int FROM dealer_branches b WHERE b.dealer_id = d.id AND b.is_active) AS branch_count,
      (SELECT COUNT(*)::int FROM dealer_members m WHERE m.dealer_id = d.id) AS member_count,
      (SELECT COUNT(*)::int FROM dealer_service_items s WHERE s.dealer_id = d.id AND s.is_active) AS service_count,
      (SELECT COUNT(*)::int FROM dealer_item_fitments f JOIN dealer_service_items s ON s.id = f.dealer_service_item_id WHERE s.dealer_id = d.id) AS fitment_count
    FROM dealers d ORDER BY d.created_at DESC`);
  sendJSON(res, 200, { data: r.rows, count: r.rowCount });
}

async function adminDealerRoute(req, res, admin, rest) {
  const db = await getDb();
  if (!rest.length) {
    if (req.method === 'GET') return listAdminDealers(res);
    if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Only GET or POST allowed');
    const body = await readBody(req);
    const displayName = text(body.display_name, null, 160);
    if (!displayName) return sendError(res, 422, 'unprocessable', 'display_name is required');
    const dealerId = `dealer-${randomUUID()}`;
    const client = await db.connect();
    try {
    await client.query('BEGIN');
    const r = await client.query(`INSERT INTO dealers
      (id, legal_name, display_name, registration_number, phone, email, website, status, created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [
      dealerId, text(body.legal_name, null, 200), displayName, text(body.registration_number, null, 100),
      text(body.phone, null, 60), text(body.email, null, 240), text(body.website, null, 500),
      'draft', admin.id,
    ]);
    const requestedKeys = Array.isArray(body.service_item_type_keys)
      ? [...new Set(body.service_item_type_keys.map((value) => text(value, null, 100)).filter(Boolean))].slice(0, 30)
      : [];
    let selectedServices = [];
    if (requestedKeys.length) {
      const types = await client.query(
        `SELECT key, display_names FROM service_item_types WHERE is_active AND key = ANY($1::text[])`,
        [requestedKeys],
      );
      if (types.rows.length !== requestedKeys.length) {
        await client.query('ROLLBACK');
        return sendError(res, 422, 'unprocessable', 'Unknown or inactive service type');
      }
      for (const type of types.rows) {
        const name = type.display_names?.['zh-Hant'] || type.display_names?.en || type.key;
        const service = await client.query(`INSERT INTO dealer_service_items
          (id,dealer_id,service_item_type_key,name)
          VALUES ($1,$2,$3,$4) RETURNING *`,
        [`service-${randomUUID()}`, dealerId, type.key, name]);
        selectedServices.push(service.rows[0]);
      }
    }
    let branch = null;
    if (body.branch?.name) {
      const created = await client.query(`INSERT INTO dealer_branches (id,dealer_id,name,address,district,phone)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [`branch-${randomUUID()}`, dealerId,
        text(body.branch.name, null, 160), text(body.branch.address, null, 300), text(body.branch.district, null, 100), text(body.branch.phone, null, 60)]);
      branch = created.rows[0];
      for (const service of selectedServices) await client.query('INSERT INTO dealer_branch_services(branch_id,service_id) VALUES($1,$2)',[branch.id,service.id]);
    }
    await client.query('COMMIT');
    await audit({ actor: admin, action: 'dealer.create', targetType: 'dealer', targetId: dealerId, payload: { dealer: r.rows[0], services: selectedServices.map((service) => service.service_item_type_key) }, req });
    return sendJSON(res, 201, { dealer: r.rows[0], services: selectedServices, branch });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  if (rest.length === 1 && rest[0] === 'service-item-types' && req.method === 'GET') {
    const r = await db.query(`SELECT key, category, display_names FROM service_item_types WHERE is_active ORDER BY category, key`);
    return sendJSON(res, 200, { data: r.rows });
  }

  const dealerId = id(rest[0], 'dealer_id');
  const dealer = await getDealer(db, dealerId);
  if (rest[1] === 'invites' && req.method === 'POST') {
    const body = await readBody(req);
    const inviteEmail = email(body.email);
    const role = DEALER_ROLES.has(body.role) ? body.role : 'staff';
    const existing = await db.query('SELECT id, email FROM users WHERE email = $1 AND is_active = TRUE', [inviteEmail]);
    if (existing.rowCount) {
      await db.query(`INSERT INTO dealer_members (dealer_id,user_id,role) VALUES ($1,$2,$3)
        ON CONFLICT (dealer_id,user_id) DO UPDATE SET role=EXCLUDED.role`, [dealerId, existing.rows[0].id, role]);
      await audit({ actor: admin, action: 'dealer.member.add', targetType: 'dealer', targetId: dealerId, payload: { email: inviteEmail, role }, req });
      return sendJSON(res, 201, { membership: { dealer_id: dealerId, user_id: existing.rows[0].id, role }, invitation_sent: false });
    }
    const token = randomBytes(24).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const r = await db.query(`INSERT INTO dealer_invites (dealer_id,email,role,token_hash,expires_at,created_by_user_id)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '7 days',$5) RETURNING id,email,role,expires_at`, [dealerId, inviteEmail, role, tokenHash, admin.id]);
    await audit({ actor: admin, action: 'dealer.invite.create', targetType: 'dealer', targetId: dealerId, payload: { email: inviteEmail, role, invite_id: r.rows[0].id }, req });
    return sendJSON(res, 201, { invite: r.rows[0], invite_token: token, note: 'Email delivery is not configured; share this token securely.' });
  }

  if (rest[1] === 'branches' && (req.method === 'GET' || req.method === 'POST')) {
    if (req.method === 'GET') {
      const r = await db.query('SELECT * FROM dealer_branches WHERE dealer_id=$1 ORDER BY name', [dealerId]);
      return sendJSON(res, 200, { data: r.rows });
    }
    const body = await readBody(req);
    const name = text(body.name, null, 160);
    if (!name) return sendError(res, 422, 'unprocessable', 'Branch name is required');
    const r = await db.query(`INSERT INTO dealer_branches (id,dealer_id,name,address,district,phone,opening_hours)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [`branch-${randomUUID()}`, dealerId, name, text(body.address, null, 300), text(body.district, null, 100), text(body.phone, null, 60), JSON.stringify(body.opening_hours || {})]);
    await audit({ actor: admin, action: 'dealer.branch.create', targetType: 'dealer', targetId: dealerId, payload: { branch: r.rows[0] }, req });
    return sendJSON(res, 201, { branch: r.rows[0] });
  }

  if (req.method === 'GET' && rest.length === 1) {
    const [branches, members, services] = await Promise.all([
      db.query('SELECT * FROM dealer_branches WHERE dealer_id=$1 ORDER BY name', [dealerId]),
      db.query(`SELECT m.dealer_id,m.user_id,m.role,u.email,u.display_name FROM dealer_members m JOIN users u ON u.id=m.user_id WHERE m.dealer_id=$1 ORDER BY u.email`, [dealerId]),
      db.query(`SELECT s.*, COUNT(f.id)::int AS fitment_count FROM dealer_service_items s LEFT JOIN dealer_item_fitments f ON f.dealer_service_item_id=s.id WHERE s.dealer_id=$1 GROUP BY s.id ORDER BY s.name`, [dealerId]),
    ]);
    return sendJSON(res, 200, { dealer, branches: branches.rows, members: members.rows, services: services.rows });
  }

  if (req.method === 'PATCH' && rest.length === 1) {
    const body = await readBody(req);
    const fields = []; const values = [];
    for (const [field, max] of [['legal_name', 200], ['display_name', 160], ['registration_number', 100], ['phone', 60], ['email', 240], ['website', 500]]) {
      if (body[field] !== undefined) { fields.push(`${field}=$${values.length + 1}`); values.push(text(body[field], null, max)); }
    }
    if (body.status !== undefined) {
      if (!['draft', 'active', 'suspended'].includes(body.status)) return sendError(res, 422, 'unprocessable', 'Invalid dealer status');
      if (body.status === 'active') {
        const ready = await db.query(`SELECT
          EXISTS(SELECT 1 FROM dealer_branches WHERE dealer_id=$1 AND is_active AND address IS NOT NULL) AS branch,
          EXISTS(SELECT 1 FROM dealer_service_items WHERE dealer_id=$1 AND is_active) AS service`, [dealerId]);
        if (!(body.phone || dealer.phone || body.email || dealer.email) || !ready.rows[0].branch || !ready.rows[0].service)
          return sendError(res, 422, 'incomplete_setup', 'Add contact information, a branch address and at least one service before activation');
      }
      fields.push(`status=$${values.length + 1}`); values.push(body.status);
    }
    if (!fields.length) return sendJSON(res, 200, { dealer });
    values.push(dealerId);
    const r = await db.query(`UPDATE dealers SET ${fields.join(',')},updated_at=NOW() WHERE id=$${values.length} RETURNING *`, values);
    await audit({ actor: admin, action: 'dealer.update', targetType: 'dealer', targetId: dealerId, payload: { before: dealer, after: r.rows[0] }, req });
    return sendJSON(res, 200, { dealer: r.rows[0] });
  }
  return sendError(res, 404, 'not_found', 'Dealer route not found');
}

async function acceptInvite(req, res, user) {
  const body = await readBody(req);
  const token = text(body.token, null, 200);
  if (!token) return sendError(res, 422, 'unprocessable', 'Invite token is required');
  const hash = createHash('sha256').update(token).digest('hex');
  const db = await getDb();
  const r = await db.query(`SELECT * FROM dealer_invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at > NOW() AND lower(email)=lower($2)`, [hash, user.email]);
  if (!r.rowCount) return sendError(res, 400, 'invalid_invite', 'Invite is invalid, expired, or not for this account');
  const invite = r.rows[0];
  await db.query('INSERT INTO dealer_members (dealer_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (dealer_id,user_id) DO UPDATE SET role=EXCLUDED.role', [invite.dealer_id, user.id, invite.role]);
  await db.query('UPDATE dealer_invites SET accepted_at=NOW() WHERE id=$1', [invite.id]);
  await audit({ actor: user, action: 'dealer.invite.accept', targetType: 'dealer', targetId: invite.dealer_id, payload: { invite_id: invite.id }, req });
  sendJSON(res, 200, { ok: true, dealer_id: invite.dealer_id, role: invite.role });
}

async function dealerPortalRoute(req, res, path, query) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (path === '/api/dealer/invites/accept' && req.method === 'POST') return acceptInvite(req, res, user);
  const db = await getDb();

  if (path === '/api/dealer/me' && req.method === 'GET') {
    const r = await db.query(`SELECT d.*,dm.role FROM dealer_members dm JOIN dealers d ON d.id=dm.dealer_id WHERE dm.user_id=$1 ORDER BY d.display_name`, [user.id]);
    return sendJSON(res, 200, { data: r.rows });
  }

  const serviceMatch = path.match(/^\/api\/dealer\/services(?:\/([^/]+))?$/);
  const branchRoute = path.match(/^\/api\/dealer\/branches(?:\/([^/]+)\/services)?$/);
  if (branchRoute) {
    const dealerId = await resolveDealerForUser(req,res,db,user);
    const member = await getMember(db,dealerId,user.id);
    if (req.method === 'GET') {
      const rows = await db.query(`SELECT b.*,COALESCE((SELECT json_agg(service_id) FROM dealer_branch_services bs WHERE bs.branch_id=b.id AND bs.is_active),'[]') AS service_ids FROM dealer_branches b WHERE dealer_id=$1 ORDER BY name`,[dealerId]);
      return sendJSON(res,200,{data:rows.rows});
    }
    if (req.method !== 'PUT' || !branchRoute[1]) return sendError(res,405,'method_not_allowed','Use GET or PUT');
    if (!EDIT_ROLES.has(member.role)) return sendError(res,403,'forbidden','Manager access required');
    const body = await readBody(req);
    if (!Array.isArray(body.service_ids) || body.service_ids.length>100) return sendError(res,422,'unprocessable','service_ids array required');
    const serviceIds=[...new Set(body.service_ids.map(value=>id(value)))];
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      const branch=await client.query('SELECT id FROM dealer_branches WHERE id=$1 AND dealer_id=$2 FOR UPDATE',[branchRoute[1],dealerId]);
      if (!branch.rowCount) throw new Error('Branch not found');
      const services=await client.query('SELECT id FROM dealer_service_items WHERE dealer_id=$1 AND id=ANY($2::text[]) AND is_active',[dealerId,serviceIds]);
      if (services.rowCount!==serviceIds.length) throw new Error('Invalid branch service');
      await client.query('DELETE FROM dealer_branch_services WHERE branch_id=$1',[branchRoute[1]]);
      for (const serviceId of serviceIds) await client.query('INSERT INTO dealer_branch_services(branch_id,service_id) VALUES($1,$2)',[branchRoute[1],serviceId]);
      await client.query('COMMIT'); return sendJSON(res,200,{service_ids:serviceIds});
    } catch(error){await client.query('ROLLBACK');return sendError(res,422,'unprocessable',error.message);}
    finally{client.release();}
  }
  if (serviceMatch) {
    const dealerId = await resolveDealerForUser(req, res, db, user);
    const member = await getMember(db, dealerId, user.id);
    if (!member || member.status !== 'active') return sendError(res, 403, 'forbidden', 'Dealer access denied');
    const serviceId = serviceMatch[1] ? id(serviceMatch[1], 'service_id') : null;
    if (req.method === 'GET') {
      const params = [dealerId]; const filter = serviceId ? ' AND s.id=$2' : '';
      if (serviceId) params.push(serviceId);
      const r = await db.query(`SELECT s.*,COALESCE(json_agg(f) FILTER (WHERE f.id IS NOT NULL),'[]') AS fitments
        FROM dealer_service_items s LEFT JOIN dealer_item_fitments f ON f.dealer_service_item_id=s.id
        WHERE s.dealer_id=$1${filter} GROUP BY s.id ORDER BY s.name`, params);
      return sendJSON(res, 200, { data: r.rows });
    }
    if (!EDIT_ROLES.has(member.role)) return sendError(res, 403, 'forbidden', 'Catalog editing requires dealer manager access');
    const body = await readBody(req);
    const itemKey = text(body.service_item_type_key, null, 100);
    const name = text(body.name, null, 160);
    if (!itemKey || !name) return sendError(res, 422, 'unprocessable', 'service_item_type_key and name are required');
    const type = await db.query('SELECT key FROM service_item_types WHERE key=$1 AND is_active', [itemKey]);
    if (!type.rowCount) return sendError(res, 422, 'unprocessable', 'Unknown service item type');
    const fields = [itemKey, name, text(body.description, null, 1000), body.interval_km == null ? null : Number(body.interval_km), body.interval_months == null ? null : Number(body.interval_months), body.price_min == null ? null : Number(body.price_min), body.price_max == null ? null : Number(body.price_max), text(body.currency, 'MOP', 8), dealerId];
    if (serviceId) {
      const r = await db.query(`UPDATE dealer_service_items SET service_item_type_key=$1,name=$2,description=$3,interval_km=$4,interval_months=$5,price_min=$6,price_max=$7,currency=$8,updated_at=NOW() WHERE id=$9 AND dealer_id=$10 RETURNING *`, [...fields.slice(0, 8), serviceId, dealerId]);
      if (!r.rowCount) return sendError(res, 404, 'not_found', 'Service item not found');
      return sendJSON(res, 200, { service: r.rows[0] });
    }
    const r = await db.query(`INSERT INTO dealer_service_items (id,dealer_id,service_item_type_key,name,description,interval_km,interval_months,price_min,price_max,currency)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [`service-${randomUUID()}`, dealerId, ...fields.slice(0, 8)]);
    return sendJSON(res, 201, { service: r.rows[0] });
  }

  const fitmentMatch = path.match(/^\/api\/dealer\/fitments(?:\/([^/]+))?$/);
  if (fitmentMatch) {
    const dealerId = await resolveDealerForUser(req, res, db, user);
    const member = await getMember(db, dealerId, user.id);
    if (!member || !EDIT_ROLES.has(member.role)) return sendError(res, 403, 'forbidden', 'Fitment editing requires dealer manager access');
    const fitmentId = fitmentMatch[1] ? id(fitmentMatch[1], 'fitment_id') : null;
    if (req.method === 'GET') {
      const r = await db.query(`SELECT f,s.name AS service_name FROM dealer_item_fitments f JOIN dealer_service_items s ON s.id=f.dealer_service_item_id WHERE s.dealer_id=$1 ORDER BY s.name,f.make_norm,f.model_norm`, [dealerId]);
      return sendJSON(res, 200, { data: r.rows });
    }
    const body = await readBody(req);
    const serviceId = id(body.dealer_service_item_id, 'dealer_service_item_id');
    const service = await db.query('SELECT id FROM dealer_service_items WHERE id=$1 AND dealer_id=$2', [serviceId, dealerId]);
    if (!service.rowCount) return sendError(res, 404, 'not_found', 'Service item not found');
    const vals = [serviceId, text(body.market), text(body.make_norm), text(body.model_norm), body.year_from == null ? null : Number(body.year_from), body.year_to == null ? null : Number(body.year_to), text(body.variant_norm), text(body.fuel_type_norm), text(body.engine_code), text(body.vin_prefix), JSON.stringify(Array.isArray(body.source_urls) ? body.source_urls.slice(0, 10) : []), text(body.notes, null, 1000)];
    if (fitmentId) {
      const r = await db.query(`UPDATE dealer_item_fitments SET dealer_service_item_id=$1,market=$2,make_norm=$3,model_norm=$4,year_from=$5,year_to=$6,variant_norm=$7,fuel_type_norm=$8,engine_code=$9,vin_prefix=$10,source_urls=$11,notes=$12,updated_at=NOW() WHERE id=$13 AND dealer_service_item_id IN (SELECT id FROM dealer_service_items WHERE dealer_id=$14) RETURNING *`, [...vals, fitmentId, dealerId]);
      if (!r.rowCount) return sendError(res, 404, 'not_found', 'Fitment not found');
      return sendJSON(res, 200, { fitment: r.rows[0] });
    }
    const r = await db.query(`INSERT INTO dealer_item_fitments (id,dealer_service_item_id,market,make_norm,model_norm,year_from,year_to,variant_norm,fuel_type_norm,engine_code,vin_prefix,source_urls,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [`fit-${randomUUID()}`, ...vals]);
    return sendJSON(res, 201, { fitment: r.rows[0] });
  }

  const requestMatch = path.match(/^\/api\/dealer\/service-requests(?:\/([^/]+))?$/);
  if (requestMatch && (req.method === 'GET' || req.method === 'PATCH')) {
    const dealerId = await resolveDealerForUser(req, res, db, user);
    const member = await getMember(db, dealerId, user.id);
    if (!member || !['owner', 'manager', 'staff', 'viewer'].includes(member.role)) return sendError(res, 403, 'forbidden', 'Dealer access denied');
    if (req.method === 'GET') {
      const r = await db.query(`SELECT r.*,v.model AS vehicle_model,v.make,v.year,v.fuel_type,u.email AS user_email,s.name AS service_name
        FROM dealer_service_requests r JOIN vehicles v ON v.id=r.vehicle_id JOIN users u ON u.id=r.user_id
        LEFT JOIN dealer_service_items s ON s.id=r.dealer_service_item_id WHERE r.dealer_id=$1 ORDER BY r.created_at DESC`, [dealerId]);
      return sendJSON(res, 200, { data: r.rows });
    }
    if (!['owner', 'manager', 'staff'].includes(member.role)) return sendError(res, 403, 'forbidden', 'Request updates require staff access');
    const body = await readBody(req); const requestId = id(body.id || requestMatch[1], 'request_id');
    if (!REQUEST_STATUSES.has(body.status)) return sendError(res, 422, 'unprocessable', 'Invalid request status');
    const r = await db.query(`UPDATE dealer_service_requests SET status=$1,scheduled_at=$2,updated_at=NOW() WHERE id=$3 AND dealer_id=$4 RETURNING *`, [body.status, body.scheduled_at ? new Date(body.scheduled_at) : null, requestId, dealerId]);
    if (!r.rowCount) return sendError(res, 404, 'not_found', 'Service request not found');
    await audit({ actor: user, action: 'dealer.request.update', targetType: 'dealer_service_request', targetId: requestId, payload: { status: body.status }, req });
    return sendJSON(res, 200, { request: r.rows[0] });
  }

  return sendError(res, 404, 'not_found', 'Dealer route not found');
}

async function vehicleRoute(req, res, path) {
  const match = path.match(/^\/api\/vehicles\/([^/]+)\/(dealer-matches|service-requests)$/);
  if (!match) return false;
  const user = await requireUser(req, res);
  if (!user) return true;
  const vehicleId = decodeURIComponent(match[1]);
  const db = await getDb();
  const vehicle = await getOwnedVehicle(db, user.id, vehicleId);

  if (match[2] === 'dealer-matches' && req.method === 'GET') {
    const { query } = pathInfo(req);
    const params = [];
    const dealerFilter = query.get('dealer_id') ? ' AND d.id=$1' : '';
    if (query.get('dealer_id')) params.push(id(query.get('dealer_id'), 'dealer_id'));
    const [statuses, catalog] = await Promise.all([
      db.query('SELECT item,service_item_type_key,wear,last_done_km,last_done_at FROM vehicle_status WHERE vehicle_id=$1 ORDER BY display_order,id', [vehicleId]),
      db.query(`SELECT d.id AS dealer_id,d.display_name AS dealer_name,b.id AS branch_id,b.name AS branch_name,s.id AS service_item_id,s.service_item_type_key,s.name AS service_name,s.description,s.price_min,s.price_max,s.currency,
          f.id AS fitment_id,f.market,f.make_norm,f.model_norm,f.year_from,f.year_to,f.variant_norm,f.fuel_type_norm,f.engine_code,f.vin_prefix
        FROM dealers d JOIN dealer_service_items s ON s.dealer_id=d.id AND s.is_active
        JOIN dealer_branch_services bs ON bs.service_id=s.id AND bs.is_active
        JOIN dealer_branches b ON b.id=bs.branch_id AND b.dealer_id=d.id AND b.is_active
        LEFT JOIN dealer_item_fitments f ON f.dealer_service_item_id=s.id
        WHERE d.status='active'${dealerFilter}`, params),
    ]);
    const result = calculateDealerMatches(vehicle, statuses.rows, catalog.rows.map((row) => ({ ...row, fitment: row.fitment_id ? row : null })));
    const unique = new Map();
    for (const match of result.matches) {
      const key = `${match.branch_id}:${match.service_item_id}`;
      if (!unique.has(key) || match.match_score > unique.get(key).match_score) unique.set(key, match);
    }
    return sendJSON(res, 200, { vehicle, matches: [...unique.values()], branches: rankBranches([...unique.values()], statuses.rows), unmatched_needs: result.unmatched_needs });
  }

  if (match[2] === 'service-requests' && req.method === 'POST') {
    const body = await readBody(req);
    const dealerId = id(body.dealer_id, 'dealer_id');
    const dealer = await db.query('SELECT id FROM dealers WHERE id=$1 AND status=\'active\'', [dealerId]);
    if (!dealer.rowCount) return sendError(res, 404, 'not_found', 'Active dealer not found');
    const serviceId = body.dealer_service_item_id ? id(body.dealer_service_item_id, 'dealer_service_item_id') : null;
    let serviceKey = text(body.service_item_type_key, null, 100);
    if (serviceId) {
      const service = await db.query('SELECT id,service_item_type_key FROM dealer_service_items WHERE id=$1 AND dealer_id=$2 AND is_active', [serviceId, dealerId]);
      if (!service.rowCount) return sendError(res, 404, 'not_found', 'Dealer service not found');
      serviceKey = service.rows[0].service_item_type_key;
    }
    const branchId = body.branch_id ? id(body.branch_id, 'branch_id') : null;
    if (!branchId || !serviceId) return sendError(res,422,'unprocessable','Select a branch and service');
    const rules=await db.query(`SELECT f.*,s.name,s.service_item_type_key FROM dealer_service_items s LEFT JOIN dealer_item_fitments f ON f.dealer_service_item_id=s.id WHERE s.id=$1 AND s.dealer_id=$2`,[serviceId,dealerId]);
    const checked=calculateDealerMatches(vehicle,[],rules.rows.map(row=>({...row,service_item_id:serviceId,dealer_id:dealerId,fitment:row.id?row:null})));
    if (!checked.matches.length) return sendError(res,422,'incompatible','Service is not compatible with this vehicle');
    if (body.package_id) {
      const pkg=await db.query('SELECT id FROM dealer_service_packages WHERE id=$1 AND dealer_id=$2 AND is_active',[body.package_id,dealerId]);
      if (!pkg.rowCount) return sendError(res,422,'unprocessable','Invalid merchant package');
    }
    if (branchId) {
      const branch = await db.query('SELECT id FROM dealer_branches WHERE id=$1 AND dealer_id=$2 AND is_active', [branchId, dealerId]);
      if (!branch.rowCount) return sendError(res, 404, 'not_found', 'Dealer branch not found');
      if (serviceId) {
        const offered=await db.query('SELECT 1 FROM dealer_branch_services WHERE branch_id=$1 AND service_id=$2 AND is_active',[branchId,serviceId]);
        if (!offered.rowCount) return sendError(res,422,'unprocessable','Service no longer available at this branch');
      }
    }
    const r = await db.query(`INSERT INTO dealer_service_requests (id,dealer_id,branch_id,user_id,vehicle_id,service_item_type_key,dealer_service_item_id,package_id,message)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [`request-${randomUUID()}`, dealerId, branchId, user.id, vehicleId, serviceKey, serviceId, body.package_id ? id(body.package_id, 'package_id') : null, text(body.message, null, 2000)]);
    await audit({ actor: user, action: 'dealer.request.create', targetType: 'dealer_service_request', targetId: r.rows[0].id, payload: { dealer_id: dealerId, vehicle_id: vehicleId, service_item_type_key: serviceKey }, req });
    return sendJSON(res, 201, { request: r.rows[0] });
  }
  sendError(res, 405, 'method_not_allowed', 'Method not allowed');
  return true;
}

export default async function handler(req, res) {
  try {
    const { pathname, query } = pathInfo(req);
    if (pathname === '/api/service-item-types' && req.method === 'GET') {
      if (!await requireUser(req, res)) return;
      const db = await getDb();
      const r = await db.query('SELECT key,category,display_names FROM service_item_types WHERE is_active ORDER BY category,key');
      return sendJSON(res, 200, { data: r.rows });
    }
    if (/^\/api\/vehicles\/[^/]+\/(dealer-matches|service-requests)$/.test(pathname))
      return await vehicleRoute(req, res, pathname);
    if (pathname.startsWith('/api/admin/dealers')) {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const rest = pathname.slice('/api/admin/dealers'.length).split('/').filter(Boolean).map(decodeURIComponent);
      return await adminDealerRoute(req, res, admin, rest);
    }
    if (pathname.startsWith('/api/dealer')) return await dealerPortalRoute(req, res, pathname, query);
    sendError(res, 404, 'not_found', 'Dealer route not found');
  } catch (error) {
    sendError(res, 500, 'internal_error', error.message);
  }
}
