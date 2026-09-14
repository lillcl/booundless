import {getDb} from '../_lib/db.js';
import {requireAdmin,requireUser} from '../_lib/auth.js';
import {readBody,sendJSON,sendError} from '../_lib/http.js';

export function validateTracking(body){
  if(['ga4','ads','request_label','vehicle_label','booking_label'].some(key=>body[key]))throw new Error('僅支援站內推廣');
  if(!Array.isArray(body.promotions)||body.promotions.length>50)throw new Error('請提供最多50項站內推廣');
  return {enabled:body.enabled===true,promotions:body.promotions.map(p=>{
    if(typeof p.dealer_id!=='string'||!p.dealer_id||p.dealer_id.length>100||!Number.isFinite(Date.parse(p.starts_at))||!Number.isFinite(Date.parse(p.ends_at))||Date.parse(p.ends_at)<=Date.parse(p.starts_at))throw new Error('商戶或期間無效');
    return {dealer_id:p.dealer_id,starts_at:new Date(p.starts_at).toISOString(),ends_at:new Date(p.ends_at).toISOString()};
  })};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');const path=new URL(req.url,'http://localhost').pathname;
  try{
    if(path==='/api/marketing/config'&&req.method==='GET'){
      const db=await getDb();const row=(await db.query('SELECT config FROM marketing_integrations WHERE id=TRUE')).rows[0];
      return sendJSON(res,200,{config:{enabled:row?.config?.enabled===true}});
    }
    if(path==='/api/admin/marketing/tracking'){
      const admin=await requireAdmin(req,res);if(!admin)return;
      const db=await getDb();
      if(req.method==='GET'){
        const settings=(await db.query('SELECT * FROM marketing_integrations WHERE id=TRUE')).rows[0];
        const report=await db.query("SELECT event_name,campaign,source,count(*)::int AS count FROM conversion_events WHERE created_at>NOW()-INTERVAL '90 days' GROUP BY event_name,campaign,source ORDER BY count DESC LIMIT 100");
        settings.config={enabled:settings.config.enabled===true,promotions:settings.config.promotions||[]};
        return sendJSON(res,200,{settings,report:report.rows});
      }
      if(req.method==='PATCH'){
        const body=await readBody(req);const config=validateTracking(body.config||{});
        for(const p of config.promotions){const dealer=await db.query("SELECT id FROM dealers WHERE id=$1 AND status='active'",[p.dealer_id]);if(!dealer.rowCount)throw new Error('推廣商戶必須已啟用');}
        const result=await db.query('UPDATE marketing_integrations SET config=$1,version=version+1,updated_by=$2,updated_at=NOW() WHERE id=TRUE AND version=$3 RETURNING *',[config,admin.id,body.version]);
        return result.rowCount?sendJSON(res,200,{settings:result.rows[0]}):sendError(res,409,'conflict','Settings changed; reload');
      }
    }
    if(path==='/api/marketing/conversions'&&req.method==='POST'){
      const user=await requireUser(req,res);if(!user)return;
      const body=await readBody(req);if(body.consent!==true)return sendError(res,422,'consent_required','Measurement consent required');
      if(typeof body.business_id!=='string'||body.business_id.length>120)return sendError(res,422,'unprocessable','Invalid reference');
      const db=await getDb();
      let owned;
      const settings=(await db.query('SELECT config FROM marketing_integrations WHERE id=TRUE')).rows[0];
      if(!settings?.config.enabled)return sendJSON(res,200,{recorded:false,event_id:null});
      if(body.event_name==='vehicle_created')owned=await db.query('SELECT id FROM vehicles WHERE id=$1 AND created_by_user_id=$2 AND archived_at IS NULL',[body.business_id,user.id]);
      else if(['service_request_submitted','booking_confirmed'].includes(body.event_name))owned=await db.query("SELECT id FROM dealer_service_requests WHERE id=$1 AND user_id=$2 AND ($3='service_request_submitted' OR status IN ('scheduled','completed'))",[body.business_id,user.id,body.event_name]);
      if(!owned?.rowCount)return sendError(res,422,'invalid_event','No matching owned outcome');
      const clean=value=>String(value||'').replace(/[^a-zA-Z0-9_ .-]/g,'').slice(0,100);
      await db.query("DELETE FROM conversion_events WHERE created_at<NOW()-INTERVAL '90 days'");
      const event=await db.query('INSERT INTO conversion_events(user_id,event_name,business_id,campaign,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',[user.id,body.event_name,body.business_id,clean(body.campaign),clean(body.source)]);
      return sendJSON(res,200,{recorded:!!event.rowCount,event_id:event.rows[0]?.id||null});
    }
    return sendError(res,405,'method_not_allowed','Unsupported tracking operation');
  }catch(error){return sendError(res,422,'unprocessable',error.message);}
}
