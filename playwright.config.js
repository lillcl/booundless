import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';

// E2E fixtures create and remove database rows. Refuse to use the app DB.
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for E2E tests');
const savedConfig = (() => { try { return parse(readFileSync(new URL('./.env', import.meta.url))); } catch { return {}; } })();
if ([savedConfig.KC_DATABASE_URL, savedConfig.SUPABASE_DB_URL].filter(Boolean).includes(process.env.TEST_DATABASE_URL)) {
  throw new Error('TEST_DATABASE_URL must differ from the configured app database URL');
}
process.env.KC_DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.KC_AUTO_MIGRATE = '0';
delete process.env.SUPABASE_DB_URL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'PORT=3100 node scripts/dev-server.js',
    env: { NODE_ENV: 'test', KC_AUTO_MIGRATE: '0' },
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
