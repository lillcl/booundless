import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('.',import.meta.url));
const original=await readFile(dir+'qinao-guide-text-edition.html','utf8');
let page=await readFile(dir+'qinao-guide.template.html','utf8');
const comparison=original.match(/<table>[\s\S]*?<\/table>/)[0].replace('<table>','<table class="comparison">');
const sources=[...original.matchAll(/<a class="source"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<b>(.*?)<\/b>[\s\S]*?<small>(.*?)<\/small>[\s\S]*?<\/a>/g)].map(([,url,title,desc])=>`<a href="${url}" target="_blank" rel="noopener"><div>${title}<span>${desc}</span></div><b aria-hidden="true">↗</b></a>`).join('');
if(!sources)throw new Error('Official links were not found');
const sections=[...original.matchAll(/<section id="(hengqin|north|trip|family|service)"[^>]*>([\s\S]*?)<\/section>/g)];
const names={hengqin:'橫琴單牌車',north:'澳車北上',trip:'行程規劃',family:'家庭出遊',service:'維修保養'};
const reference=sections.map(([,id,html])=>`<h3>${names[id]}</h3>`+html.replace(/<span class="label">[\s\S]*?<\/span>/g,'').replace(/<h2>[\s\S]*?<\/h2>/g,'').replace(/<h3>/g,'<h4>').replace(/<\/h3>/g,'</h4>')).join('').replace(/^[ \t]+$/gm,'');
const logo=await readFile(dir+'../../assets/icons/mjsseya-logo.png');
page=page.replace('{{COMPARISON}}',comparison).replace('{{SOURCES}}',sources).replace('{{REFERENCE}}',reference).replaceAll('{{MJSSE_LOGO}}',`data:image/png;base64,${logo.toString('base64')}`);
if(/\{\{[A-Z_]+\}\}/.test(page))throw new Error('Unresolved template');
const image=await readFile(dir+'qinao-scenes.png');
await writeFile(dir+'qinao-guide.source.html',page);
const standalone=page.replace('background-image:var(--sheet)',`background-image:url('data:image/png;base64,${image.toString('base64')}')`);
await writeFile(dir+'qinao-guide.html',standalone);
const website=standalone
  .replaceAll('https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js','/assets/vendor/gsap.min.js')
  .replaceAll('https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js','/assets/vendor/ScrollTrigger.min.js');
const websitePath=dir+'../../qinao-guide.html';
// The deployed guide has curated interaction and readability layers beyond the
// portable template. Keep that page intact and use it as the canonical website
// knowledge source; only fall back to the portable build for a fresh checkout.
const knowledgeWebsite=await readFile(websitePath,'utf8').catch(async()=>{
  await writeFile(websitePath,website);
  return website;
});

const decodeText=(value)=>value
  .replace(/&nbsp;/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;|&apos;/g,"'")
  .replace(/&lt;/g,'<')
  .replace(/&gt;/g,'>');
const plainText=(value)=>decodeText(value
  .replace(/<script\b[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/\s+/g,' ')
  .trim());
const knowledgeSections=[
  {id:'compare',title:'橫琴單牌車與澳車北上比較',topics:['琴澳同行','跨境自駕','橫琴單牌車','澳車北上','通關口岸']},
  {id:'apply',title:'琴澳跨境自駕申請準備',topics:['琴澳同行','申請資格','申請文件','驗車','保險','牌證']},
  {id:'trip',title:'橫琴與珠海行程編排',topics:['琴澳同行','橫琴景點','珠海景點','親子行程','泊車']},
  {id:'service',title:'北上汽車維修與保固',topics:['汽車維修','維修報價','零件','工時','保固','交車紀錄']},
  {id:'check',title:'琴澳自駕出發前檢查',topics:['出發檢查','駕駛證','保險','預約','車輛安全']},
  {id:'official',title:'琴澳同行官方入口',topics:['官方入口','澳門海關','交通事務局','橫琴官方','汽車維修規定']},
];
const verifiedMatch=knowledgeWebsite.match(/資料核對日期：(\d{4})年(\d{1,2})月(\d{1,2})日/);
const verifiedAt=verifiedMatch
  ? `${verifiedMatch[1]}-${verifiedMatch[2].padStart(2,'0')}-${verifiedMatch[3].padStart(2,'0')}`
  : null;
const sourceLinksFrom=(html)=>[...html.matchAll(/<a\b[^>]*href="(https?:\/\/[^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  .map(([,url,label])=>({title:plainText(label).replace(/\s*↗\s*$/,'').slice(0,240),url}))
  .filter((item,sourceIndex,all)=>item.title&&all.findIndex((candidate)=>candidate.url===item.url)===sourceIndex)
  .slice(0,20);
const officialMarkerIndex=knowledgeWebsite.indexOf('id="official"');
const officialSection=officialMarkerIndex<0?'':knowledgeWebsite.slice(
  knowledgeWebsite.lastIndexOf('<section',officialMarkerIndex),
  knowledgeWebsite.indexOf('</main>',officialMarkerIndex),
);
const globalOfficialLinks=sourceLinksFrom(officialSection);
const knowledge=knowledgeSections.map((section,index)=>{
  const marker=`id="${section.id}"`;
  const markerIndex=knowledgeWebsite.indexOf(marker);
  if(markerIndex<0)throw new Error(`Knowledge section ${section.id} was not found`);
  const start=knowledgeWebsite.lastIndexOf('<section',markerIndex);
  const next=knowledgeSections[index+1];
  const nextMarker=next?knowledgeWebsite.indexOf(`id="${next.id}"`,markerIndex+marker.length):knowledgeWebsite.indexOf('</main>',markerIndex);
  const end=nextMarker<0?knowledgeWebsite.length:knowledgeWebsite.lastIndexOf('<section',nextMarker);
  const html=knowledgeWebsite.slice(start,end>start?end:nextMarker);
  const directSourceLinks=sourceLinksFrom(html);
  const sourceLinks=directSourceLinks.length?directSourceLinks:globalOfficialLinks;
  return {
    id:`qinao.${section.id}`,
    source:'琴澳同行',
    title:section.title,
    content:plainText(html).slice(0,24000),
    page_url:'/guide',
    anchor:`#${section.id}`,
    route_key:`qinao.${section.id}`,
    topics:section.topics,
    official_sources:sourceLinks,
    verified_at:verifiedAt,
    time_sensitive:true,
  };
});
const knowledgeDir=dir+'../../assets/knowledge';
await mkdir(knowledgeDir,{recursive:true});
await writeFile(knowledgeDir+'/qinao.json',JSON.stringify({version:1,source_url:'/guide',verified_at:verifiedAt,documents:knowledge},null,2)+'\n');

// A small, deterministic knowledge graph complements full-text retrieval. It
// keeps provenance explicit and lets the assistant follow relationships such
// as topic -> guide section -> official source without trusting model memory.
const graphNodes=[];
const graphEdges=[];
const nodeIds=new Set();
const edgeIds=new Set();
const addNode=(node)=>{
  if(nodeIds.has(node.id))return;
  nodeIds.add(node.id);
  graphNodes.push(node);
};
const addEdge=(edge)=>{
  const id=`${edge.from}|${edge.type}|${edge.to}`;
  if(edgeIds.has(id))return;
  edgeIds.add(id);
  graphEdges.push({id,...edge});
};
const slug=(value)=>Buffer.from(value).toString('base64url');
addNode({id:'source.qinao',type:'source',label:'琴澳同行',url:'/guide',verified_at:verifiedAt});
for(const document of knowledge){
  addNode({
    id:document.id,
    type:'document',
    label:document.title,
    url:`${document.page_url}${document.anchor}`,
    route_key:document.route_key,
    verified_at:document.verified_at,
    time_sensitive:document.time_sensitive,
  });
  addEdge({from:'source.qinao',type:'contains',to:document.id});
  for(const topic of document.topics){
    const topicId=`topic.${slug(topic)}`;
    addNode({id:topicId,type:'topic',label:topic});
    addEdge({from:document.id,type:'about',to:topicId});
  }
  for(const official of document.official_sources){
    const officialId=`official.${slug(official.url)}`;
    addNode({id:officialId,type:'official_source',label:official.title,url:official.url});
    addEdge({from:document.id,type:'cites',to:officialId});
  }
}
const specificTopics=new Map();
for(const document of knowledge){
  for(const topic of document.topics.filter((value)=>value!=='琴澳同行')){
    if(!specificTopics.has(topic))specificTopics.set(topic,[]);
    specificTopics.get(topic).push(document.id);
  }
}
for(const [topic,documentIds] of specificTopics){
  if(documentIds.length<2)continue;
  for(let index=0;index<documentIds.length;index+=1){
    for(let other=index+1;other<documentIds.length;other+=1){
      addEdge({from:documentIds[index],type:'related_to',to:documentIds[other],label:topic});
    }
  }
}
const graph={
  version:1,
  source_url:'/guide',
  verified_at:verifiedAt,
  generated_from:['assets/knowledge/qinao.json'],
  nodes:graphNodes,
  edges:graphEdges,
};
await writeFile(knowledgeDir+'/graph.json',JSON.stringify(graph,null,2)+'\n');
console.log(`Built source, standalone guide, preserved the curated Boundless route, and generated ${knowledge.length} knowledge sections plus a ${graphNodes.length}-node/${graphEdges.length}-edge knowledge graph: ${(Buffer.byteLength(knowledgeWebsite)/1024/1024).toFixed(2)} MB; ${sections.length} reference sections; ${sources.match(/<a /g).length} official links.`);
