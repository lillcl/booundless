import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { readBody,sendJSON,sendError } from '../_lib/http.js';

export function quoteItems(items) {
  if (!Array.isArray(items)||!items.length||items.length>30) throw new Error('Provide 1–30 quote lines');
  const result=items.map(item=>{
    if(typeof item.description!=='string'||!item.description.trim()||item.description.length>200||!Number.isInteger(item.amount_minor)||item.amount_minor<0||item.amount_minor>10000000) throw new Error('Invalid quote item');
    return {description:item.description.trim(),amount_minor:item.amount_minor};
  });
  return {items:result,total:result.reduce((sum,item)=>sum+item.amount_minor,0)};
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const user=await requireUser(req,res);if(!user)return;
  const path=new URL(req.url,'http://localhost').pathname;
  const match=path.match(/^\/api\/service-requests(?:\/([^/]+))?$/);
  if(!match)return sendError(res,404,'not_found','Request route not found');
  const db=await getDb();
  if(req.method==='GET') {
    const result=await db.query(`SELECT r.*,d.display_name AS dealer_name,v.model,
      EXISTS(SELECT 1 FROM dealer_members m WHERE m.dealer_id=r.dealer_id AND m.user_id=$1 AND m.role IN ('owner','manager','staff') AND d.status='active') AS can_manage,
      COALESCE((SELECT json_agg(q ORDER BY q.version DESC) FROM dealer_quotes q WHERE q.request_id=r.id),'[]') AS quotes
      ,COALESCE((SELECT json_agg(i) FROM dealer_request_items i WHERE i.request_id=r.id),'[]') AS items
      FROM dealer_service_requests r JOIN dealers d ON d.id=r.dealer_id JOIN vehicles v ON v.id=r.vehicle_id
      WHERE (r.user_id=$1 OR EXISTS(SELECT 1 FROM dealer_members m WHERE m.dealer_id=r.dealer_id AND m.user_id=$1 AND d.status='active'))
      AND ($2::text IS NULL OR r.id=$2) ORDER BY r.created_at DESC LIMIT 100`,[user.id,match[1]||null]);
    return sendJSON(res,200,{data:result.rows});
  }
  if(req.method!=='POST'||!match[1])return sendError(res,405,'method_not_allowed','Use GET or POST to a request ID');
  const body=await readBody(req);
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    const r=(await client.query('SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE',[match[1]])).rows[0];
    if(!r){await client.query('ROLLBACK');return sendError(res,404,'not_found','Request not found');}
    const member=(await client.query(`SELECT m.role FROM dealer_members m JOIN dealers d ON d.id=m.dealer_id WHERE m.dealer_id=$1 AND m.user_id=$2 AND d.status='active'`,[r.dealer_id,user.id])).rows[0];
    const customer=r.user_id===user.id;
    const operator=member&&['owner','manager','staff'].includes(member.role);
    if(!customer&&!operator){await client.query('ROLLBACK');return sendError(res,403,'forbidden','Request access denied');}
    if(body.version!==r.version){await client.query('ROLLBACK');return sendError(res,409,'conflict','Request changed; refresh before trying again');}
    let next=r.status;
    if(body.action==='quote') {
      if(!operator||!['new','quoted'].includes(r.status))throw new Error('Cannot quote this request');
      const {items,total}=quoteItems(body.items);
      if(!['MOP','HKD','CNY'].includes(body.currency))throw new Error('Unsupported currency');
      const expires=new Date(body.expires_at);
      if(!Number.isFinite(expires.getTime())||expires<=new Date()||expires.getTime()>Date.now()+30*86400000)throw new Error('Quote expiry must be within 30 days');
      await client.query(`INSERT INTO dealer_quotes(request_id,version,currency,items,total_minor,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,[r.id,r.version+1,body.currency,JSON.stringify(items),total,expires,user.id]);next='quoted';
    } else if(body.action==='accept_quote') {
      if(!customer||r.status!=='quoted')throw new Error('Only the owner can accept a current quote');
      const q=(await client.query('SELECT * FROM dealer_quotes WHERE request_id=$1 ORDER BY version DESC LIMIT 1',[r.id])).rows[0];
      if(!q||q.id!==body.quote_id||new Date(q.expires_at)<=new Date())throw new Error('Quote has changed or expired');
      await client.query('UPDATE dealer_quotes SET accepted_at=NOW() WHERE id=$1',[q.id]);next='accepted';
    } else if(body.action==='schedule') {
      if(!operator||r.status!=='accepted')throw new Error('Accept a quote before scheduling');
      const scheduled=new Date(body.scheduled_at);
      if(!Number.isFinite(scheduled.getTime())||scheduled<=new Date())throw new Error('Future appointment time required');
      await client.query('UPDATE dealer_service_requests SET scheduled_at=$1 WHERE id=$2',[scheduled,r.id]);next='scheduled';
    } else if(body.action==='complete') {
      if(!operator||r.status!=='scheduled')throw new Error('Only scheduled work can be completed');next='completed';
    } else if(body.action==='confirm_completion') {
      if(!customer||r.status!=='completed'||r.completion_confirmed_at)throw new Error('Completion already confirmed or unavailable');
      const q=(await client.query('SELECT * FROM dealer_quotes WHERE request_id=$1 AND accepted_at IS NOT NULL ORDER BY version DESC LIMIT 1',[r.id])).rows[0];
      if(!q)throw new Error('No accepted quote');
      await client.query(`INSERT INTO service_history(id,vehicle_id,performed_at,kind,title,notes,cost,mileage_km)
        SELECT $1,v.id,NOW(),'merchant_service','車商服務完成',$2,$3,v.mileage_km FROM vehicles v WHERE v.id=$4`,
        ['request-'+r.id,q.items.map(i=>i.description).join('；'),`${q.currency} ${(q.total_minor/100).toFixed(2)}`,r.vehicle_id]);
      await client.query('UPDATE dealer_service_requests SET completion_confirmed_at=NOW() WHERE id=$1',[r.id]);
      await client.query(`UPDATE vehicle_status SET wear=0,last_done_at=NOW(),last_done_km=(SELECT mileage_km FROM vehicles WHERE id=$2) WHERE vehicle_id=$2 AND service_item_type_key IN (SELECT service_key FROM dealer_request_items WHERE request_id=$1)`,[r.id,r.vehicle_id]);
      await client.query(`INSERT INTO vehicle_needs(vehicle_id,service_key,state,urgency,source)
        SELECT DISTINCT $2,service_key,'resolved','routine','merchant_completion' FROM dealer_request_items WHERE request_id=$1
        ON CONFLICT(vehicle_id,service_key) DO UPDATE SET state='resolved',source='merchant_completion',updated_at=NOW()`,[r.id,r.vehicle_id]);
    } else if(body.action==='cancel') {
      if(['completed','cancelled','declined'].includes(r.status))throw new Error('Request is already closed');next='cancelled';
    } else if(body.action==='decline') {
      if(!operator||!['new','quoted'].includes(r.status))throw new Error('Cannot decline this request');next='declined';
    } else throw new Error('Unknown action');
    const updated=await client.query('UPDATE dealer_service_requests SET status=$1,version=version+1,updated_at=NOW() WHERE id=$2 RETURNING *',[next,r.id]);
    await client.query('INSERT INTO dealer_request_events(request_id,actor_id,action) VALUES($1,$2,$3)',[r.id,user.id,body.action]);
    await client.query('COMMIT');return sendJSON(res,200,{request:updated.rows[0]});
  } catch(error){await client.query('ROLLBACK');return sendError(res,422,'unprocessable',error.message);}
  finally{client.release();}
}
