/** Fresh sqlite DB + demo users before the suite (unique file per run). */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

async function setup() {
  const backend = resolve(here, '../../backend');
  const dbFile = process.env.E2E_DB_FILE ?? 'e2e-test.db';
  const db = join(backend, dbFile);
  // best-effort cleanup of yesterday's run files (never the live one)
  try {
    for (const f of readdirSync(backend)) {
      if (/^e2e-(run-.*|test)\.db/.test(f) && f !== dbFile) {
        const p = join(backend, f);
        try {
          if (Date.now() - statSync(p).mtimeMs > 24 * 3600 * 1000) unlinkSync(p);
        } catch { /* locked or gone */ }
      }
    }
  } catch { /* ignore */ }
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const r = spawnSync(py, ['seed.py'], {
    cwd: backend,
    env: { ...process.env, DATABASE_URL: `sqlite:///./${dbFile}` },
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    throw new Error(`seed.py failed:\n${r.stdout}\n${r.stderr}`);
  }
}

export default setup;
