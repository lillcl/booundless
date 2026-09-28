/* Layout-only browser regression. Uses fixture responses; never connects to a database. */
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const vehicle = { id: 'layout-fixture', make: 'Mercedes-Benz', model: 'GLC 300 4MATIC 長軸距版本', year: 2024, fuel_type: 'Hybrid', plate: 'MA-23-88', vin: 'WDC12345678901234', mileage_km: 42680, scope_confirmed: false };
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    for (const [width, height] of [[320,568], [390,844], [430,932], [844,390], [1280,800]]) {
      const page = await browser.newPage({ viewport: {width,height}, isMobile: width < 900, hasTouch: true });
      await page.route('http://passport.test/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/assets/passport.js') return route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../assets/passport.js',import.meta.url),'utf8')});
        if (path.startsWith('/api/')) {
          const body = path === '/api/vehicles' ? {data:[vehicle, {...vehicle,id:'second'}]} : path.endsWith('/status') ? {items:[],data_complete:false} : {data:[]};
          return route.fulfill({json:body});
        }
        if (path === '/') return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}button,input{font:inherit}${readFileSync(new URL('../assets/passport.css',import.meta.url),'utf8')}</style><div id="root"></div><script type="module">import {renderVehiclePassports} from '/assets/passport.js';renderVehiclePassports(document.querySelector('#root'));</script>`});
        return route.fulfill({status:204,body:''});
      });
      await page.goto('http://passport.test/');
      await page.locator('.vp-book').first().waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), `${name} ${width}: shelf overflow`);
      await page.locator('.vp-book').first().click();
      await page.locator('.vp-inspection-link').waitFor();
      await page.screenshot({path:`/tmp/passport-reader-${name}-${width}.png`,animations:'disabled'});
      const geometry = await page.locator('.vp-reader__book').evaluate(el => ({width:el.clientWidth,scrollWidth:el.scrollWidth}));
      assert.ok(geometry.scrollWidth <= geometry.width, `${name} ${width}: reader overflow ${JSON.stringify(geometry)}`);
      if(width <= 820) {
        await page.locator('.vp-reader__book').evaluate(el=>{el.scrollTop=el.scrollHeight;});
        const link = await page.locator('.vp-inspection-link').boundingBox();
        const controls = await page.locator('.vp-progress').boundingBox();
        assert.ok(link.y + link.height <= controls.y, `${name} ${width}: bottom content hidden by page controls`);
      }
      await page.locator('[data-edit-passport]').click();
      await page.locator('.vp-editor.is-open').waitFor();
      assert.ok(await page.locator('.vp-editor__panel').evaluate(el=>el.scrollWidth<=el.clientWidth), `${name} ${width}: editor overflow`);
      await page.locator('[data-editor-cancel]').click();
      await page.locator('.vp-reader__close').click();
      await page.locator('.vp-reader').waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
      await page.screenshot({path:`/tmp/passport-${name}-${width}.png`,fullPage:true});
      console.log(`PASS ${name} ${width}x${height}: shelf, reader, editor, scroll unlock`);
      await page.close();
    }
  } finally { await browser.close(); }
}
