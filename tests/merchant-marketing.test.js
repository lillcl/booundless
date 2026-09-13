import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFitment, calculateDealerMatches, rankBranches } from '../api/_lib/dealer-matcher.js';
import { validateMetadata, renderMetadata } from '../api/_lib/marketing.js';
import { readFileSync } from 'node:fs';

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
