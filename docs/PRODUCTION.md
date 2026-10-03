# KWF Production Setup (minimal, required steps only)

> Development (SQLite, Vite dev, weak secrets) keeps working untouched.
> Everything below applies only to a real deployment.

## 1. Required environment

| Variable | Required prod | Default (dev) | Failure mode if wrong |
|---|---|---|---|
| `ENV` | `prod` | `dev` | Without `prod`, JWT fail-fast is off and dev fallbacks apply |
| `JWT_SECRET` | random, **>= 32 bytes** | `change-me-in-env` | Startup `RuntimeError` when `ENV=prod` (default/short secret refused) |
| `DATABASE_URL` | `postgresql+psycopg://USER:PASS@HOST:5432/kwf` | `sqlite:///./kwf.db` | SQLite file is ephemeral in containers; data loss on redeploy |
| `CORS_ORIGINS` | exact frontend origin(s), comma-separated | `http://localhost:5173` | Browsers block API calls; never use `*` with credentials |
| `COOKIE_SECURE` | `true` (HTTPS) | `false` | Cookies leak over plain HTTP |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | set before first seed | `admin@kwf.org` / `admin123` | Demo admin exists; rotate immediately if seeded with defaults |

Generate a secret: `openssl rand -hex 32` (64 hex chars).

Rate limits are compiled in (`backend/app/core/ratelimit.py`, in-memory):
login/register `10/60s`, verify/issue/documents `30/60s`,
tournaments `120/60s`. Do not weaken them for tests.

## 2. Deploy steps

```bash
# 1. PostgreSQL 16 (managed or docker volume pgdata — never ephemeral disk)
# 2. Backend (env from §1):
pip install -r backend/requirements.txt
cd backend && alembic upgrade head          # idempotent, safe to re-run
uvicorn app.main:app --host 0.0.0.0 --port 8000   # lifespan runs migrations again
curl http://HOST:8000/api/health             # {"ok":true,"db":true}
# 3. First admin (run ONCE, with SEED_* env set — never with defaults in prod):
python backend/seed.py
# 4. Frontend:
cd frontend && npm ci && npm run build       # nginx serves dist/, /api/ proxied to backend
```

`docker compose up --build` reproduces this locally (demo credentials only).

## 3. First admin

Via `seed.py` with `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (§2 step 3),
or promote in DB directly. If the demo `admin123` was ever used in prod,
rotate it immediately (passwords are bcrypt-hashed, but the default is public).

## 4. Backup / restore

- Back up: **PostgreSQL** (`pg_dump`, incl. `alembic_version`). That is the
  entire application state.
- Do NOT back up: frontend `dist/` (rebuildable), PDFs (generated on-the-fly
  from DB rows), logs, `kwf.db` dev files.
- Restore: fresh DB → `pg_restore` → start backend (migrations no-op on
  current schema) → verify `/api/health` → spot-check `/api/verify/{code}`.

## 5. Rollback

Application rollback = redeploy previous image/tag. **Do not roll back
migrations** (0001 downgrade is a documented no-op; others drop columns).
All Wave 3+ migrations are additive/idempotent — old code on a newer schema
ignores unknown columns, new code on an older schema fails fast at startup
(migration error, loud, no silent corruption).

## 6. Known operational notes

- QR codes contain `verify:{CODE}` (not a URL) — verification goes through
  the frontend `/verify` page. Changing the format would invalidate already
  printed codes; keep as debt until a URL-based scheme is adopted.
- `strict_eligibility` column is inert (warnings-only eligibility) — ignore it.
- Fonts (DejaVu, OFL) ship inside the backend image (`app/assets/fonts/`);
  no system-font dependency.
- Rate limiter is per-process memory; multi-replica deployments need sticky
  sessions or a shared store (future work, not a blocker for one replica).
