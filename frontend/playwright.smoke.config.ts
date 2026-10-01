import { defineConfig } from '@playwright/test';

/** Smoke-only config: reuses the already-running backend on :8000 (verified current code).
 *  No webServer, no globalSetup — vite is started manually before the run.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['auth-smoke.spec.ts', 'roles-smoke.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
