import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { readBody,sendJSON,sendError } from '../_lib/http.js';
import { createServiceRecordTx } from '../_lib/service-records.js';
import { randomUUID } from 'node:crypto';
import {
  acceptQuoteV2, rejectQuoteV2, scheduleSlotV2,
  startService, submitCompletion, confirmCompletionV2,
} from '../_lib/service-orders.js';

export function quoteItems(items) {
  if (!Array.isArray(items)||!items.length||items.length>30) throw new Error('Provide 1–30 quote lines');
  const result=items.map(item=>{
    if(typeof item.description!=='string'||!item.description.trim()||item.description.length>200||!Number.isInteger(item.amount_minor)||item.amount_minor<0||item.amount_minor>10000000) throw new Error('Invalid quote item');
    const keys = item.service_keys ?? [];
    if (!Array.isArray(keys) || keys.length > 30 || keys.some(key => typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(key))) throw new Error('Invalid quote service keys');
    return {description:item.description.trim(),amount_minor:item.amount_minor,service_keys:[...new Set(keys)]};
  });
  return {items:result,total:result.reduce((sum,item)=>sum+item.amount_minor,0)};
}

export function validateCompletion({ service_keys, mileage_km, total_minor, notes }, quote) {
  if(!Array.isArray(service_keys)||service_keys.length>30||service_keys.some(key=>typeof key!=='string'))throw new Error('List the work actually completed');
  if(!Number.isInteger(mileage_km)||mileage_km<0||mileage_km>10000000)throw new Error('Actual completion mileage is required');
  if(typeof notes!=='string'||!notes.trim()||notes.length>3000)throw new Error('Completion notes are required');
  if(!Number.isInteger(total_minor)||total_minor<0||total_minor>quote.total_minor)throw new Error('Final amount must not exceed the accepted quote');
  const approvedKeys=new Set(quote.items.flatMap(item=>item.service_keys||[]));
  const completedKeys=[...new Set(service_keys)];
  if(completedKeys.some(key=>!approvedKeys.has(key)))throw new Error('Completed work must be in the accepted quote');
  return { completedKeys, mileage: mileage_km, total: total_minor, notes: notes.trim() };
}

export function selectedQuoteLines(items, indexes) {
  const selected = indexes == null ? items.map((_, index) => index) : indexes;
  if(!Array.isArray(selected)||!selected.length||selected.length>items.length||
    selected.some(index=>!Number.isInteger(index)||index<0||index>=items.length)||
    new Set(selected).size!==selected.length)throw new Error('Select at least one valid quote line');
  return selected.map(index=>({ index, ...items[index] }));
}
async function notifyParticipants(client,r,actorId,action,version){
  const labels={
    quote:['quote_ready','新報價已準備','車行已提交報價，請檢視並決定。'],
    accept_quote:['quote_accepted','車主已批准報價','車主已批准所選服務項目。'],
    reject_quote:['quote_rejected','車主拒絕報價','車主已拒絕本次報價。'],
    schedule:['booking_confirmed','預約已確認','服務時段已確認。'],
    start:['service_started','服務已開始','車行已開始處理車輛。'],
    complete:['completion_submitted','完工報告待確認','車行已提交完工報告，請檢視。'],
    confirm_completion:['completion_confirmed','完工已確認','車主已確認完工紀錄。'],
    cancel:['request_cancelled','服務請求已取消','服務請求已取消。'],
    decline:['request_declined','車行未能接單','車行已婉拒本次服務請求。'],
  };
  const info=labels[action];if(!info)return;
  const recipients=(await client.query(`SELECT $1::text AS user_id UNION SELECT user_id FROM dealer_members
    WHERE dealer_id=$2 AND role IN ('owner','manager','staff')`,[r.user_id,r.dealer_id])).rows;
  for(const recipient of recipients){
    if(recipient.user_id===actorId)continue;
    await client.query(`INSERT INTO notifications(user_id,request_id,event_id,type,title,body)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,event_id,type) DO NOTHING`,
      [recipient.user_id,r.id,`${r.id}:${action}:${version}`,info[0],info[1],info[2]]);
  }
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
      ,COALESCE((SELECT json_agg(l ORDER BY l.quote_line_index) FROM service_order_lines l WHERE l.request_id=r.id),'[]') AS order_lines
      FROM dealer_service_requests r JOIN dealers d ON d.id=r.dealer_id JOIN vehicles v ON v.id=r.vehicle_id
      WHERE (r.user_id=$1 OR EXISTS(SELECT 1 FROM dealer_members m WHERE m.dealer_id=r.dealer_id AND m.user_id=$1 AND d.status='active'))
      AND ($2::text IS NULL OR r.id=$2) ORDER BY r.created_at DESC LIMIT 100`,[user.id,match[1]||null]);
    if(!match[1]) return sendJSON(res,200,{data:result.rows});
    if(!result.rowCount) return sendError(res,404,'not_found','Request not found');
    const detail=result.rows[0];
    const [booking,changes,reports,completion,attachments,cases]=await Promise.all([
      db.query(`SELECT sb.id,sb.slot_id,sb.status,bs.starts_at,bs.ends_at,bs.branch_id
        FROM service_bookings sb JOIN booking_slots bs ON bs.id=sb.slot_id
        WHERE sb.request_id=$1 ORDER BY sb.created_at DESC LIMIT 1`,[detail.id]),
      db.query(`SELECT * FROM service_changes WHERE request_id=$1 ORDER BY created_at DESC`,[detail.id]),
      db.query(`SELECT ir.*,
        COALESCE((SELECT json_agg(x ORDER BY x.check_key) FROM inspection_results x WHERE x.report_id=ir.id),'[]') AS results
        FROM inspection_reports ir WHERE ir.request_id=$1 ORDER BY ir.revision DESC`,[detail.id]),
      db.query(`SELECT sc.*,
        COALESCE((SELECT json_agg(cl ORDER BY sol.quote_line_index,sol.change_line_index)
          FROM service_completion_lines cl JOIN service_order_lines sol ON sol.id=cl.order_line_id
          WHERE cl.completion_id=sc.id),'[]') AS lines
        FROM service_completions sc WHERE sc.request_id=$1 ORDER BY sc.revision DESC LIMIT 1`,[detail.id]),
      db.query(`SELECT id,mime_type,size_bytes,purpose,inspection_result_id,order_line_id,upload_state,created_at
        FROM service_attachments WHERE request_id=$1 AND upload_state='ready' ORDER BY created_at`,[detail.id]),
      db.query(`SELECT id,kind,description,status,resolution,created_at,updated_at
        FROM service_cases WHERE request_id=$1 ORDER BY created_at DESC`,[detail.id]),
    ]);
    detail.booking=booking.rows[0]||null;
    detail.changes=changes.rows;
    detail.inspection_reports=reports.rows;
    detail.completion=completion.rows[0]||null;
    detail.attachments=attachments.rows;
    detail.cases=cases.rows;
    detail.has_pending_change=detail.changes.some(change=>change.status==='proposed');
    const isOwner=detail.user_id===user.id;
    if(isOwner)detail.can_manage=false;
    detail.viewer_role=isOwner?'owner':(detail.can_manage?'operator':'viewer');
    detail.action_options=[];
    if(isOwner&&detail.status==='quoted')detail.action_options.push('accept_quote','reject_quote');
    if(isOwner&&detail.status==='accepted')detail.action_options.push('schedule');
    if(isOwner&&detail.has_pending_change)detail.action_options.push('decide_change');
    if(isOwner&&detail.work_state==='completion_submitted')detail.action_options.push('confirm_completion','open_case');
    if(detail.can_manage&&['new','quoted'].includes(detail.status))detail.action_options.push('quote');
    if(detail.can_manage&&detail.status==='scheduled'&&detail.work_state!=='in_progress')detail.action_options.push('start');
    if(detail.can_manage&&detail.work_state==='in_progress')detail.action_options.push('inspect','propose_change','complete');
    return sendJSON(res,200,{data:detail});
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
    // A user may belong to a dealer while also owning this request. Keep the
    // two sides separate so one account cannot quote, perform and approve its
    // own work.
    const operator=!customer&&member&&['owner','manager','staff'].includes(member.role);
    if(!customer&&!operator){await client.query('ROLLBACK');return sendError(res,403,'forbidden','Request access denied');}
    if(body.version!==r.version){await client.query('ROLLBACK');return sendError(res,409,'conflict','Request changed; refresh before trying again');}
    let next=r.status;
    if(body.action==='quote') {
      if(!operator||!['new','quoted'].includes(r.status))throw new Error('Cannot quote this request');
      const {items,total}=quoteItems(body.items);
      // Preserve line_id + quantity + parts fields when present (v2 items).
      const storedItems = items.map((it, i) => {
        const raw = Array.isArray(body.items) ? body.items[i] : null;
        return raw && typeof raw === 'object'
          ? { ...it, line_id: raw.line_id || it.line_id || randomUUID(), quantity: raw.quantity ?? 1,
              parts_unit_minor: raw.parts_unit_minor ?? 0, labour_minor: raw.labour_minor ?? it.amount_minor,
              parts_brand: raw.parts_brand ?? null, parts_spec: raw.parts_spec ?? null,
              part_number: raw.part_number ?? null, work_type: raw.work_type ?? 'service',
              warranty_text: raw.warranty_text ?? null }
          : it;
      });
      const requested = await client.query('SELECT DISTINCT service_key FROM dealer_request_items WHERE request_id=$1',[r.id]);
      const allowed = new Set(requested.rows.map(item=>item.service_key));
      if(items.some(item=>item.service_keys.some(key=>!allowed.has(key))))throw new Error('Quote contains a service outside this request');
      if(!['MOP','HKD','CNY'].includes(body.currency))throw new Error('Unsupported currency');
      const expires=new Date(body.expires_at);
      if(!Number.isFinite(expires.getTime())||expires<=new Date()||expires.getTime()>Date.now()+30*86400000)throw new Error('Quote expiry must be within 30 days');
      await client.query(`INSERT INTO dealer_quotes(request_id,version,currency,items,total_minor,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,[r.id,r.version+1,body.currency,JSON.stringify(storedItems),total,expires,user.id]);next='quoted';
    } else if(body.action==='accept_quote') {
      if(!customer)throw new Error('Only the owner can accept a current quote');
      const q=(await client.query('SELECT * FROM dealer_quotes WHERE request_id=$1 ORDER BY version DESC LIMIT 1',[r.id])).rows[0];
      if(!q||q.id!==body.quote_id)throw new Error('Quote has changed; refresh and try again');
      if(new Date(q.expires_at)<=new Date())throw new Error('Quote has expired');
      if(r.workflow_version>=2){
        let selectedLineIds=body.selected_line_ids;
        if(!Array.isArray(selectedLineIds)&&Array.isArray(body.selected_line_indexes)){
          selectedLineIds=selectedQuoteLines(q.items,body.selected_line_indexes).map((line)=>line.line_id).filter(Boolean);
        }
        await acceptQuoteV2(client, { requestId:r.id, userId:user.id, quoteId:q.id, selectedLineIds:selectedLineIds||[] });
      } else {
        const approved=selectedQuoteLines(q.items,body.selected_line_indexes);
        await client.query('UPDATE dealer_quotes SET accepted_at=NOW() WHERE id=$1',[q.id]);
        await client.query('UPDATE dealer_service_requests SET accepted_quote_id=$1 WHERE id=$2',[q.id,r.id]);
        for(const line of approved)await client.query(`INSERT INTO service_order_lines
          (request_id,quote_id,quote_line_index,description,amount_minor,service_keys) VALUES($1,$2,$3,$4,$5,$6)`,
        [r.id,q.id,line.index,line.description,line.amount_minor,line.service_keys||[]]);
      }
      next='accepted';
    } else if(body.action==='reject_quote') {
      if(!customer)throw new Error('Only the owner can reject a quote');
      await rejectQuoteV2(client, { requestId:r.id, userId:user.id, quoteId:body.quote_id, reason:body.reason });
      next='new';
    } else if(body.action==='schedule') {
      if(body.slot_id){
        if(!operator&&!customer)throw new Error('Only the owner or operator can schedule');
        await scheduleSlotV2(client, { requestId:r.id, userId:user.id, slotId:body.slot_id, operator: !!operator });
      } else {
        if(!operator||r.status!=='accepted')throw new Error('Accept a quote before scheduling');
        const scheduled=new Date(body.scheduled_at);
        if(!Number.isFinite(scheduled.getTime())||scheduled<=new Date())throw new Error('Future appointment time required');
        await client.query('UPDATE dealer_service_requests SET scheduled_at=$1 WHERE id=$2',[scheduled,r.id]);
      }
      next='scheduled';
    } else if(body.action==='start') {
      if(!operator)throw new Error('Only operator can start');
      await startService(client, { requestId:r.id, userId:user.id });
      next='scheduled';
    } else if(body.action==='complete') {
      if(!operator)throw new Error('Only operator can complete');
      if(r.workflow_version>=2){
        if(!body.completion||!Array.isArray(body.completion.lines))throw new Error('completion.lines required');
        if(!Number.isInteger(body.completion.mileage_km)||body.completion.mileage_km<0)throw new Error('Valid mileage_km required');
        await submitCompletion(client, {
          requestId:r.id, userId:user.id,
          completion: {
            mileage_km:body.completion.mileage_km,
            started_at:body.completion.started_at||r.scheduled_at||new Date().toISOString(),
            finished_at:body.completion.finished_at||new Date().toISOString(),
            duration_minutes:body.completion.duration_minutes,
            technician_name:String(body.completion.technician_name||'').slice(0,200),
            notes:body.completion.notes,
            lines:body.completion.lines
          }
        });
      } else {
        const quote=await client.query(`SELECT items,total_minor FROM dealer_quotes WHERE request_id=$1 AND accepted_at IS NOT NULL
          AND ($2::uuid IS NULL OR id=$2) ORDER BY version DESC LIMIT 1`,[r.id,r.accepted_quote_id]);
        if(!quote.rowCount)throw new Error('Accepted quote not found');
        let approvedQuote=quote.rows[0];
        if(r.workflow_version>=2){
          const lines=await client.query('SELECT service_keys,amount_minor FROM service_order_lines WHERE request_id=$1',[r.id]);
          if(!lines.rowCount)throw new Error('Approved order lines are missing');
          approvedQuote={items:lines.rows,total_minor:lines.rows.reduce((sum,line)=>sum+line.amount_minor,0)};
        }
        const completion=validateCompletion(body,approvedQuote);
        await client.query(`UPDATE dealer_service_requests SET completed_service_keys=$1,completion_mileage_km=$2,
          completion_performed_at=NOW(),completion_notes=$3,completed_by_user_id=$4,completion_total_minor=$5 WHERE id=$6`,
        [completion.completedKeys,completion.mileage,completion.notes,user.id,completion.total,r.id]);
      }
      next='completed';
    } else if(body.action==='confirm_completion') {
      if(!customer)throw new Error('Only the owner can confirm completion');
      if(r.workflow_version>=2){
        await confirmCompletionV2(client, { requestId:r.id, userId:user.id });
      } else {
        if(r.status!=='completed'||r.completion_confirmed_at)throw new Error('Completion already confirmed or unavailable');
        const q=(await client.query(`SELECT * FROM dealer_quotes WHERE request_id=$1 AND accepted_at IS NOT NULL
          AND ($2::uuid IS NULL OR id=$2) ORDER BY version DESC LIMIT 1`,[r.id,r.accepted_quote_id])).rows[0];
        if(!q)throw new Error('No accepted quote');
        if(r.completion_mileage_km==null||r.completion_total_minor==null||!r.completion_performed_at||!r.completed_by_user_id)throw new Error('Completion report is missing');
        await createServiceRecordTx(client, {vehicleId:r.vehicle_id,userId:r.completed_by_user_id,dealerId:r.dealer_id,branchId:r.branch_id,
          requestId:r.id,source:'service_request',body:{title:'車商服務完成',kind:'merchant_service',
            performed_at:r.completion_performed_at,mileage_km:r.completion_mileage_km,
            service_keys:r.completed_service_keys,notes:r.completion_notes,
            cost:`${q.currency} ${(r.completion_total_minor/100).toFixed(2)}`}});
        await client.query('UPDATE dealer_service_requests SET completion_confirmed_at=NOW() WHERE id=$1',[r.id]);
      }
    } else if(body.action==='cancel') {
      if(['completed','cancelled','declined'].includes(r.status))throw new Error('Request is already closed');
      if(r.started_at||['in_progress','awaiting_approval','completion_submitted'].includes(r.work_state))throw new Error('Started work cannot be cancelled; open a case instead');
      await client.query(`UPDATE service_bookings SET status='cancelled',cancelled_at=NOW()
        WHERE request_id=$1 AND status='confirmed'`,[r.id]);
      next='cancelled';
    } else if(body.action==='decline') {
      if(!operator||!['new','quoted'].includes(r.status))throw new Error('Cannot decline this request');next='declined';
    } else throw new Error('Unknown action');
    const updated=await client.query('UPDATE dealer_service_requests SET status=$1,version=version+1,updated_at=NOW() WHERE id=$2 RETURNING *',[next,r.id]);
    await client.query('INSERT INTO dealer_request_events(request_id,actor_id,action) VALUES($1,$2,$3)',[r.id,user.id,body.action]);
    await notifyParticipants(client,r,user.id,body.action,updated.rows[0].version);
    await client.query('COMMIT');return sendJSON(res,200,{request:updated.rows[0]});
  } catch(error){await client.query('ROLLBACK');return sendError(res,422,'unprocessable',error.message);}
  finally{client.release();}
}
