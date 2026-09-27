import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(new URL('./qinao-guide.html',import.meta.url).href);
await page.evaluate(()=>document.fonts.ready);
await page.locator('.scene').first().evaluate(async e=>{const url=getComputedStyle(e).backgroundImage;if(url==='none')throw new Error('Missing illustration');const image=new Image();image.src=url.slice(5,-2);await image.decode();});
await page.screenshot({path:'/private/tmp/qinao-v4-desktop.png'});
for(const id of ['apply','trip','family','service']){
 await page.locator('#'+id).evaluate(e=>e.scrollIntoView({behavior:'instant'}));
 await page.screenshot({path:`/private/tmp/qinao-v4-${id}.png`});
}
const desktop=await page.evaluate(()=>({brokenAnchors:[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.querySelector(a.hash)).map(a=>a.hash),visibleSteps:[...document.querySelectorAll('.process li')].filter(e=>e.checkVisibility()).length,officialLinks:document.querySelectorAll('.sources a').length,overflow:document.documentElement.scrollWidth>innerWidth}));
await page.locator('.checklist input').first().check();
if(await page.locator('.progress').textContent()!=='1 / 8 已確認')throw new Error('Checklist counter failed');
await page.locator('#reset').click();
if(await page.locator('.progress').textContent()!=='0 / 8 已確認')throw new Error('Checklist reset failed');
const mobile=[];
for(const width of [390,320,768]){
 await page.setViewportSize({width,height:844});
 await page.evaluate(()=>scrollTo(0,0));
 mobile.push(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})));
 if(width===390){await page.screenshot({path:'/private/tmp/qinao-v4-mobile.png'});await page.locator('#trip').evaluate(e=>e.scrollIntoView({behavior:'instant'}));await page.screenshot({path:'/private/tmp/qinao-v4-mobile-trip.png'});}
}
await page.locator('.extra summary').first().click();
if(!(await page.locator('.extra').first().getAttribute('open')!==null))throw new Error('Reference expansion failed');
console.log(JSON.stringify({desktop,mobile,errors,checklist:'pass',reference:'pass'},null,2));
await browser.close();
