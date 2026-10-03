import { defineConfig } from '@playwright/test';

// Unique sqlite file per run: deleting a live sqlite file is unreliable on
// Windows, so runs never share a database (stale files are gitignored).
const dbFile = `e2e-run-${Date.now()}.db`;
process.env.E2E_DB_FILE = dbFile;

/** Critical-path E2E: backend (sqlite file) + vite dev (proxy /api -> :8000). */
export default defineConfig({
  testDir: './e2e',
  // F-E2E-1: single worker. All specs share one backend/IP, and the auth
  // rate limit (10 req/60s per IP) makes parallel workers flake with 429.
  // Production limits are untouched; this is test-infra determinism only.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: 'python -m uvicorn app.main:app --port 8000',
      cwd: '../backend',
      env: { ...process.env, DATABASE_URL: `sqlite:///./${dbFile}` } as Record<string, string>,
      url: 'http://127.0.0.1:8000/api/health',
      timeout: 90_000,
    },
    {
      // --host 127.0.0.1: vite binds IPv6 ::1 by default, unreachable via 127.0.0.1 on Windows.
      command: 'npx vite --port 5173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      timeout: 90_000,
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
