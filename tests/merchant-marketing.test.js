import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFitment, calculateDealerMatches, rankBranches } from '../api/_lib/dealer-matcher.js';
import { validateMetadata, renderMetadata } from '../api/_lib/marketing.js';
import { readFileSync } from 'node:fs';
import {quoteItems} from '../api/_handlers/requests.js';
import {validateTracking} from '../api/_handlers/tracking.js';
import {sendInvitation} from '../api/_lib/invitation-mail.js';

test('missing rules never imply confirmed compatibility',()=>{
  assert.equal(scoreFitment({make:'Toyota'}, null).state,'needs_confirmation');
  assert.equal(scoreFitment({make:'Toyota'}, {}).state,'needs_confirmation');
});
test('known contradictions exclude even when another required field is missing',()=>{
  assert.equal(scoreFitment({make:'Tesla'}, {make_norm:'Toyota',year_from:2020}),null);
  assert.equal(scoreFitment({make:'Toyota'}, {make_norm:'Toyota',year_from:2020}).state,'needs_confirmation');
});
test('VIN prefix alone is not a perfect score',()=>{
  assert.ok(scoreFitment({vin:'ABC123'}, {vin_prefix:'ABC'}).score<90);
});
test('electric vehicles exclude combustion-only services',()=>{
  const result=calculateDealerMatches({fuel_type:'電動'},[{item:'機油',wear:100}],[{service_item_type_key:'engine_oil'}]);
  assert.equal(result.matches.length,0);assert.equal(result.unmatched_needs.length,0);
});
test('explicit universal support is distinguishable from unconfigured support',()=>{
  const result=calculateDealerMatches({fuel_type:'Hybrid'},[],[{service_item_type_key:'cabin_filter',compatibility_mode:'universal'}]);
  assert.equal(result.matches[0].compatibility_state,'confirmed');
});
test('model comparison handles make-prefixed display names',()=>{
  assert.equal(scoreFitment({make:'Toyota',model:'Toyota Corolla Cross'},{make_norm:'Toyota',model_norm:'Corolla Cross'}).state,'confirmed');
});
test('quote monetary values use nonnegative integer minor units',()=>{
  assert.equal(quoteItems([{description:'Oil',amount_minor:12345},{description:'Filter',amount_minor:100}]).total,12445);
  assert.throws(()=>quoteItems([{description:'Oil',amount_minor:-1}]));
  assert.throws(()=>quoteItems([{description:'Oil',amount_minor:1.5}]));
});
test('tracking rejects scripts and invalid destination IDs',()=>{
  assert.throws(()=>validateTracking({ga4:'<script>'}));assert.throws(()=>validateTracking({enabled:true}));
  assert.equal(validateTracking({enabled:false}).enabled,false);
});
test('invitation sender reports missing credentials without sending',async()=>{
  const key=process.env.RESEND_API_KEY;delete process.env.RESEND_API_KEY;
  try{const result=await sendInvitation({email:'test@example.test',link:'https://www.booundless.com',id:'test'},()=>{throw new Error('Must not send');});assert.equal(result.status,'not_configured');}
  finally{if(key)process.env.RESEND_API_KEY=key;}
});
test('invitation transport sets idempotency and does not claim failed email was sent',async()=>{
  const key=process.env.RESEND_API_KEY;const from=process.env.INVITATION_FROM_EMAIL;
  process.env.RESEND_API_KEY='test';process.env.INVITATION_FROM_EMAIL='test@example.test';
  try{const result=await sendInvitation({email:'test@example.test',link:'https://www.booundless.com',id:'test'},async(url,options)=>{assert.equal(options.headers['Idempotency-Key'],'merchant-invite-test');return {ok:false,json:async()=>({})};});assert.equal(result.status,'failed');}
  finally{if(key)process.env.RESEND_API_KEY=key;else delete process.env.RESEND_API_KEY;if(from)process.env.INVITATION_FROM_EMAIL=from;else delete process.env.INVITATION_FROM_EMAIL;}
});
test('unverified services leave needs unresolved',()=>{
  const result=calculateDealerMatches({},[{item:'機油',wear:90}],[{service_item_type_key:'engine_oil'}]);
  assert.equal(result.unmatched_needs.length,1);
});
const valid={title:'Test',description:'Description',social_title:'',social_description:'',image:'/assets/example.png',image_alt:'Test',indexable:true};
test('branch ranking counts each need once and distinguishes partial coverage',()=>{
  const statuses=[{item:'機油及機油隔',wear:90}];
  const matches=[{branch_id:'a',service_item_type_key:'engine_oil',compatibility_state:'confirmed',match_score:80},
    {branch_id:'a',service_item_type_key:'engine_oil',compatibility_state:'confirmed',match_score:90},
    {branch_id:'b',service_item_type_key:'engine_oil',compatibility_state:'confirmed',match_score:90},
    {branch_id:'b',service_item_type_key:'oil_filter',compatibility_state:'confirmed',match_score:90}];
  const result=rankBranches(matches,statuses);
  assert.equal(result[0].branch_id,'b'); assert.equal(result[0].coverage,1);assert.equal(result[1].coverage,.5);
  assert.equal(rankBranches(matches,[])[0].score,null);
});
test('metadata rejects off-site images',()=>{
  assert.throws(()=>validateMetadata({...valid,image:'https://evil.example/a.png'}));
  assert.throws(()=>validateMetadata({...valid,image:'javascript:alert(1)'}));
});
test('rendered HTML escapes untrusted values and has one canonical/title',()=>{
  const template=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const html=renderMetadata(template,'/demo',validateMetadata({...valid,title:'</title><script>bad()</script>'}));
  assert.equal((html.match(/<title>/g)||[]).length,1);
  assert.ok(!html.includes('<script>bad()</script>'));
  assert.ok(html.includes('href="https://www.booundless.com/demo"'));
  assert.ok(html.includes('data-published-metadata="true"'));
});
