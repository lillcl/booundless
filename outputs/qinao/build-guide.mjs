import {readFile,writeFile} from 'node:fs/promises';
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
await writeFile(dir+'../../qinao-guide.html',website);
console.log(`Built complete source, standalone guide, and Boundless route: ${(Buffer.byteLength(website)/1024/1024).toFixed(2)} MB; ${sections.length} reference sections; ${sources.match(/<a /g).length} official links.`);
