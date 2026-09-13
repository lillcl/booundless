// Run only against an explicitly isolated test database, never the application .env.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url=process.env.TEST_DATABASE_URL;
if (!url || !['127.0.0.1','localhost'].includes(new URL(url).hostname) || new URL(url).port!=='55439') throw new Error('Isolated local test database on port 55439 required');
process.env.SUPABASE_DB_URL=url;
process.env.KC_JWT_SECRET=randomUUID()+randomUUID();
const { getDb,closeDb }=await import('../api/_lib/db.js');
const { signSession }=await import('../api/_lib/auth.js');
const {default:handler}=await import('../api/index.js');
const {publicPage}=await import('../api/_handlers/marketing.js');
const db=await getDb();
try {
  const admin={id:'integration-admin',email:'integration-admin@example.test',role:'admin'};
  await db.query(`INSERT INTO users(id,email,password_hash,role,display_name) VALUES($1,$2,'unused','admin','Test') ON CONFLICT(id) DO NOTHING`,[admin.id,admin.email]);
  const cookie='kc_session='+await signSession(admin);
  async function call(url,method='GET',body,authenticated=true,target=handler){
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.value=value;}};
    await target({url,method,body,headers:authenticated?{cookie}:{},socket:{}},res);
    return {status:res.statusCode,body:res.headers['Content-Type']?.startsWith('text/html')?res.value:JSON.parse(res.value),headers:res.headers};
  }
  assert.equal((await call('/api/admin/marketing/pages','GET',null,false)).status,401);
  const initial=await call('/api/admin/marketing/pages'); assert.equal(initial.status,200);
  let page=initial.body.pages.find(p=>p.path==='/');
  const content={title:'整合測試標題',description:'Integration test',social_title:'',social_description:'',image:'/assets/booundless-social.png',image_alt:'Test',indexable:true};
  const saved=await call('/api/admin/marketing/pages','PATCH',{path:'/',version:page.version,content});assert.equal(saved.status,200);
  assert.equal((await call('/api/admin/marketing/pages','PATCH',{path:'/',version:page.version,content})).status,409);
  const published=await call('/api/admin/marketing/pages','POST',{path:'/',version:saved.body.page.version});assert.equal(published.status,200);
  const html=await call('/','GET',null,false,publicPage);assert.ok(html.body.includes('<title>整合測試標題</title>'));
  const before=(await db.query('SELECT count(*)::int AS n FROM dealers')).rows[0].n;
  const invalid=await call('/api/admin/dealers','POST',{display_name:'invalid',service_item_type_keys:['not-real']});assert.equal(invalid.status,422);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM dealers')).rows[0].n,before);
  const created=await call('/api/admin/dealers','POST',{display_name:'Test workshop',phone:'1234',service_item_type_keys:['engine_oil'],branch:{name:'Test branch',address:'Test address'}});assert.equal(created.status,201);
  assert.ok(created.body.branch.id);
  const offerings=await db.query('SELECT * FROM dealer_branch_services WHERE branch_id=$1',[created.body.branch.id]);assert.equal(offerings.rowCount,1);
  assert.equal((await call('/api/admin/dealers/'+created.body.dealer.id,'PATCH',{status:'active'})).status,200);
  const vehicleId='integration-vehicle-'+randomUUID();
  await db.query(`INSERT INTO vehicles(id,model,make,year,created_by_user_id) VALUES($1,'Corolla','Toyota',2021,$2)`,[vehicleId,admin.id]);
  const request={dealer_id:created.body.dealer.id,branch_id:created.body.branch.id,dealer_service_item_id:created.body.services[0].id};
  assert.equal((await call('/api/vehicles/'+vehicleId+'/service-requests','POST',request)).status,201);
  await db.query(`INSERT INTO dealer_item_fitments(id,dealer_service_item_id,make_norm) VALUES($1,$2,'Tesla')`,['fit-'+randomUUID(),created.body.services[0].id]);
  assert.equal((await call('/api/vehicles/'+vehicleId+'/service-requests','POST',request)).status,422);
  const revision=(await db.query('SELECT id FROM marketing_revisions WHERE page_path=$1 ORDER BY id DESC LIMIT 1',['/'])).rows[0];
  assert.equal((await call('/api/admin/marketing/pages','POST',{path:'/',version:published.body.page.version,revision_id:revision.id})).status,200);
  const {getOwnedVehicle}=await import('../api/_lib/tool-utils.js');
  await assert.rejects(()=>getOwnedVehicle(db,'not-owner',vehicleId));
  console.log('PASS: auth gate, SEO draft/publish/raw HTML/version conflict, invalid catalogue rollback, merchant+branch+offering transaction, activation');
} finally {await closeDb();}
