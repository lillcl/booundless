/* Browser smoke check with mocked API responses. No account or database writes. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const base = process.env.CHECK_BASE_URL || 'http://127.0.0.1:3188';
const image = process.argv[2] || fileURLToPath(new URL('../assets/vehicle-tesla.jpg', import.meta.url));
const browser = await chromium.launch({ headless: true });
const aiCalls = [];
const vehiclePosts = [];
let failVision = false;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openPage() {
  const page = await browser.newPage();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/auth/me') return json(route, { user: { id: 'flow-test', email: 'flow@example.test', display_name: 'Flow Test', role: 'user', is_active: true } });
    if (path === '/api/dealer/me') return json(route, { data: [] });
    if (path === '/api/ai') {
      const body = request.postDataJSON();
      aiCalls.push(body.mode);
      if (failVision) return json(route, { error: { message: 'Vision temporarily unavailable' } }, 503);
      return json(route, { vehicle: { make: 'Tesla', model: 'Model Y', body_color: '白色', vehicle_class: 'light_passenger', fuel_type: '純電', plate: 'M HY 2266 E', year: null, vin: '', confidence: { make: 'high', model: 'high', body_color: 'high', vehicle_class: 'high', fuel_type: 'high', plate: 'medium' } } });
    }
    if (path === '/api/vehicles' && request.method() === 'POST') {
      const body = request.postDataJSON();
      vehiclePosts.push(body);
      return json(route, { id: `mock-${vehiclePosts.length}`, ...body }, 201);
    }
    if (path === '/api/vehicles') return json(route, { data: [], count: 0 });
    return json(route, { data: [] });
  });
  await page.goto(`${base}/#/garage`);
  await page.locator('[data-add-passport]').waitFor({ state: 'visible' });
  return page;
}

try {
  const aiPage = await openPage();
  await aiPage.locator('[data-add-passport]').click();
  await aiPage.locator('[data-add-mode="ai"]').click();
  assert.equal(await aiPage.locator('[data-brand]').count(), 0, 'AI path should not ask for a brand before recognition');
  await aiPage.locator('#carInput').setInputFiles(image);
  await aiPage.locator('#carPreview.show').waitFor({ state: 'visible' });
  await aiPage.locator('#continueCaptureBtn').click();
  await aiPage.locator('#newVehicleMake').waitFor({ state: 'visible' });
  assert.equal(await aiPage.locator('#newVehicleMake').inputValue(), 'Tesla');
  assert.equal(await aiPage.locator('#newVehicleModel').inputValue(), 'Model Y');
  assert.equal(await aiPage.locator('#newVehicleColor').inputValue(), '白色');
  assert.equal(await aiPage.locator('#newVehiclePlate').inputValue(), 'M HY 2266 E');
  assert.equal(await aiPage.locator('#newVehicleMileage').inputValue(), '');
  assert.equal(await aiPage.locator('#newVehicleYear').inputValue(), '');
  assert.deepEqual(aiCalls, ['vehicle-image']);
  await aiPage.locator('#addVehicleForm button[type="submit"]').click();
  await aiPage.getByText('車輛資料已建立').waitFor({ state: 'visible' });
  assert.equal(vehiclePosts[0].identity_source, 'ai');
  assert.equal(vehiclePosts[0].body_color, '白色');
  assert.equal(vehiclePosts[0].mileage_km, null);
  await aiPage.close();

  const manualPage = await openPage();
  await manualPage.locator('[data-add-passport]').click();
  await manualPage.locator('[data-add-mode="manual"]').click();
  await manualPage.locator('[data-class="light_passenger"]').click();
  await manualPage.locator('[data-powertrain="ev"]').click();
  await manualPage.locator('[data-brand="Tesla"]').click();
  await manualPage.locator('#newVehicleModel').fill('Model Y');
  await manualPage.locator('#newVehiclePlate').fill('AA-1234');
  assert.deepEqual(aiCalls, ['vehicle-image'], 'manual path must not call image recognition');
  await manualPage.locator('#addVehicleForm button[type="submit"]').click();
  await manualPage.getByText('車輛資料已建立').waitFor({ state: 'visible' });
  assert.equal(vehiclePosts[1].identity_source, 'manual');
  assert.equal(vehiclePosts[1].make, 'Tesla');
  assert.equal(vehiclePosts[1].powertrain_type, 'ev');
  assert.equal(vehiclePosts[1].mileage_km, null);
  await manualPage.close();

  failVision = true;
  const failurePage = await openPage();
  await failurePage.locator('[data-add-passport]').click();
  await failurePage.locator('[data-add-mode="ai"]').click();
  await failurePage.locator('#carInput').setInputFiles(image);
  await failurePage.locator('#carPreview.show').waitFor({ state: 'visible' });
  await failurePage.locator('#continueCaptureBtn').click();
  await failurePage.getByText('Vision temporarily unavailable').waitFor({ state: 'visible' });
  assert.equal(await failurePage.locator('#carPreview.show').count(), 1, 'photo should remain available for retry');
  assert.equal(await failurePage.locator('#newVehicleMake').count(), 0, 'failed recognition must not look successful');
  await failurePage.close();

  const mobilePage = await openPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.locator('[data-add-passport]').click();
  assert.equal(await mobilePage.locator('[data-add-mode]').count(), 2);
  const mobileWidth = await mobilePage.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(mobileWidth.content <= mobileWidth.viewport, 'mobile onboarding must fit the viewport');
  await mobilePage.close();
  console.log('onboarding browser flow passed: AI review, manual save, recognition failure, mobile width');
} finally {
  await browser.close();
}
