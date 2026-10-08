/** Multi-role (coach AND organizer): dual formation via approve flow, per-cabinet
 *  access, cabinet switcher (UI context only), coach schedule CRUD.
 *  Serial file; starting cooldown keeps us out of the previous file's window.
 *  Auth budget is minimal: 2 registrations, logins spread across ~3 minutes.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8000';
const ORG = { email: 'organizer@kwf.org', password: 'organizer123' };
const ADMIN = { email: 'admin@kwf.org', password: 'admin123' };
const uid = `multi${Date.now() % 100000}`;
const dualEmail = `${uid}dual@kwf.org`;
const soloEmail = `${uid}solo@kwf.org`;

test.beforeAll(async () => {
  await new Promise((r) => setTimeout(r, 65_000));
});

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

async function uiLogin(page: Page, email: string, password: string, expected: RegExp = /\/(coach|organizer)(\?|$)/) {
  await page.goto('/me');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').first().getByRole('button', { name: 'Войти' }).click();
  // Role UX 3.0: /me dispatches to the role home (dual coach+organizer -> organizer).
  await expect(page).toHaveURL(expected);
}

async function uiLogout(page: Page) {
  await page.goto('/me');
  await page.locator('header').getByRole('button', { name: 'Профиль' }).click();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
}

test('coach approved as organizer keeps both roles and both cabinets', async ({ page, request }) => {
  await (await request.post(`${API}/api/auth/register`, {
    data: { email: dualEmail, password: 'secret123', full_name: 'Multi Dual', role: 'coach' },
  }));
  const coachToken = await apiLogin(request, dualEmail, 'secret123');
  await request.post(`${API}/api/auth/request-organizer`, {
    headers: { Authorization: `Bearer ${coachToken}` }, data: { org_name: `Dual Org ${uid}` },
  });
  const adminToken = await apiLogin(request, ADMIN.email, ADMIN.password);
  const reqs = (await (await request.get(`${API}/api/admin/organizer-requests`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json()).items;
  const rid = reqs.find((r: { org_name: string }) => r.org_name === `Dual Org ${uid}`).id;
  await request.post(`${API}/api/admin/organizer-requests/${rid}/decision?approve=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  // roles SET contains both (primary stays coach)
  const me = await (await request.get(`${API}/api/auth/me`, {
    headers: { Authorization: `Bearer ${coachToken}` },
  })).json();
  expect(me.role).toBe('coach');
  expect(new Set(me.roles)).toEqual(new Set(['coach', 'organizer']));
  // trainer home reachable (team content, no denial)
  await uiLogin(page, dualEmail, 'secret123', /\/organizer(\?|$)/);
  await page.goto('/coach');
  await expect(page.getByText('Мои спортсмены').first()).toBeVisible();
  // organizer home reachable (pipeline workspace, backend enforces)
  await page.goto('/organizer');
  await expect(page.getByRole('heading', { name: 'Панель организатора' })).toBeVisible();
});

test('single-role users are denied the other cabinet', async ({ page, request }) => {
  // organizer-only (seeded) has no trainer home
  await uiLogin(page, ORG.email, ORG.password, /\/organizer(\?|$)/);
  await page.goto('/coach');
  await expect(page.getByText('Нет доступа')).toBeVisible();
  await uiLogout(page);
  // coach-only has no organizer cabinet
  await (await request.post(`${API}/api/auth/register`, {
    data: { email: soloEmail, password: 'secret123', full_name: 'Solo Coach', role: 'coach' },
  }));
  await uiLogin(page, soloEmail, 'secret123');
  await page.goto('/organizer');
  await expect(page.getByText('Нет доступа')).toBeVisible();
});

test('dual role: separate homes per workspace; schedule CRUD works', async ({ page, request }) => {
  const coachToken = await apiLogin(request, dualEmail, 'secret123');
  await request.post(`${API}/api/clubs`, {
    headers: { Authorization: `Bearer ${coachToken}` },
    data: { name: `Dual Club ${uid}`, country: 'KZ', city: 'A', coach_name: 'Dual' },
  });

  await uiLogin(page, dualEmail, 'secret123', /\/organizer(\?|$)/);
  // /me dispatches dual users to the organizer home (no mixed cabinet anymore)
  await page.goto('/me');
  await expect(page).toHaveURL(/\/organizer(\?|$)/);
  const main = page.locator('main');
  // organizer home keeps organizer actions, never trainer blocks
  // (scoped to <main>: the footer always links to /organizer)
  await expect(main.getByText('Мои турниры').first()).toBeVisible();
  await expect(main.getByText('Мои спортсмены')).toHaveCount(0);
  // coach home keeps trainer blocks, never organizer creation
  // (scoped to <main>: the footer always links to /organizer)
  await page.goto('/coach');
  await expect(main.getByText('Мои спортсмены').first()).toBeVisible();
  await expect(main.getByText('Панель организатора')).toHaveCount(0);
  // schedule lives in its own coach tab now
  await page.goto('/coach?tab=schedule');
  await expect(page.getByText('Расписание тренировок').first()).toBeVisible();
  // schedule CRUD in the UI (club scoped to own club)
  const titleInput = page.getByLabel('Название занятия');
  await titleInput.fill('Morning drill');
  await expect(titleInput).toHaveValue('Morning drill');
  await page.getByLabel('Начало').fill('2026-12-01T09:00');
  await page.getByRole('button', { name: 'Добавить занятие' }).click();
  await expect(page.getByText('Morning drill')).toBeVisible({ timeout: 15000 });
  // delete asks for confirmation first (two-step, no silent loss)
  const del = main.getByRole('button', { name: '✕' }).first();
  await del.click();
  await expect(main.getByRole('button', { name: /Подтвердить/ })).toBeVisible();
  await main.getByRole('button', { name: /Подтвердить/ }).click();
  await expect(main.getByText('Morning drill')).toHaveCount(0, { timeout: 15000 });
});
