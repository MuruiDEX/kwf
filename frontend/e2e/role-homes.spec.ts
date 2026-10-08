/** Role UX 3.0: /me dispatches to the role home; each role has its own
 *  workspace; unauthorized role access shows the denied card.
 *  One product, six work environments — verified end to end.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8000';
const ORG = { email: 'organizer@kwf.org', password: 'organizer123' };
const ADMIN = { email: 'admin@kwf.org', password: 'admin123' };
const uid = `rx${Date.now() % 100000}`;

// Infra pacing (NOT a state wait): this file performs ~6 logins against the
// 10/60s per-IP auth limit; the gap keeps us out of the previous file's
// sliding window. Production limits untouched.
test.beforeAll(async () => {
  await new Promise((r) => setTimeout(r, 65_000));
});

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

async function registerAPI(request: APIRequestContext, email: string, role: string) {
  const r = await request.post(`${API}/api/auth/register`, {
    data: { email, password: 'secret123', full_name: `RX ${role}`, role },
  });
  expect(r.ok()).toBeTruthy();
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/me');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').first().getByRole('button', { name: 'Войти' }).click();
}

test('athlete: /me -> /athlete personal workspace', async ({ page, request }) => {
  const email = `${uid}ath@kwf.org`;
  await registerAPI(request, email, 'athlete');
  await uiLogin(page, email, 'secret123');
  await expect(page).toHaveURL(/\/athlete(\?|$)/);
  await expect(page.getByText('Мои заявки').first()).toBeVisible();
  await expect(page.locator('main').getByText('Создать турнир')).toHaveCount(0);
  // direct URL access works
  await page.goto('/athlete?tab=docs');
  await expect(page.getByText('Документы').first()).toBeVisible();
  // unauthorized role area is denied, not leaked
  await page.goto('/organizer');
  await expect(page.getByText('Нет доступа')).toBeVisible();
});

test('coach: /me -> /coach team workspace', async ({ page, request }) => {
  const email = `${uid}coach@kwf.org`;
  await registerAPI(request, email, 'coach');
  await uiLogin(page, email, 'secret123');
  await expect(page).toHaveURL(/\/coach(\?|$)/);
  await expect(page.getByText('Мои спортсмены').first()).toBeVisible();
  await expect(page.locator('main').getByText('Панель организатора')).toHaveCount(0);
  await page.goto('/coach?tab=regs');
  await expect(page.getByText('Заявка на турнир')).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByText('Нет доступа')).toBeVisible();
});

test('referee: /me -> /referee operational workspace', async ({ page, request }) => {
  const email = `${uid}ref@kwf.org`;
  await registerAPI(request, email, 'referee');
  await uiLogin(page, email, 'secret123');
  await expect(page).toHaveURL(/\/referee(\?|$)/);
  await expect(page.getByText('Очередь боёв').first()).toBeVisible();
  await expect(page.locator('main').getByText('Мои спортсмены')).toHaveCount(0);
  await page.goto('/organizer');
  await expect(page.getByText('Нет доступа')).toBeVisible();
});

test('organizer: /me -> /organizer pipeline workspace', async ({ page }) => {
  await uiLogin(page, ORG.email, ORG.password);
  await expect(page).toHaveURL(/\/organizer(\?|$)/);
  await expect(page.getByRole('heading', { name: 'Панель организатора' })).toBeVisible();
  await expect(page.getByText('Мои турниры').first()).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByText('Нет доступа')).toBeVisible();
});

test('admin: /me -> /admin workspace with full nav', async ({ page }) => {
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/admin(\?|$)/);
  for (const label of ['Заявки', 'Пользователи', 'Турниры', 'Новости', 'Журнал']) {
    await expect(page.getByText(label).first()).toBeVisible();
  }
});

test('guardian: /me -> /guardian ward workspace (read-only)', async ({ page, request }) => {
  const coachEmail = `${uid}gcoach@kwf.org`;
  const guardEmail = `${uid}guard@kwf.org`;
  await registerAPI(request, coachEmail, 'coach');
  const coachToken = await apiLogin(request, coachEmail, 'secret123');
  await registerAPI(request, guardEmail, 'public');
  const guardToken = await apiLogin(request, guardEmail, 'secret123');
  const CH = { Authorization: `Bearer ${coachToken}` };
  const GH = { Authorization: `Bearer ${guardToken}` };
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: CH, data: { first_name: 'Рик', last_name: `Сын${uid}`, gender: 'male', birth_year: 2015, weight_kg: 40, country: 'KZ' },
  })).json()).id as number;
  const lid = (await (await request.post(`${API}/api/guardian/links`, {
    headers: GH, data: { athlete_id: aid },
  })).json()).id as number;
  expect((await request.post(`${API}/api/guardian/links/${lid}/approve`, { headers: CH })).ok()).toBeTruthy();

  await uiLogin(page, guardEmail, 'secret123');
  await expect(page).toHaveURL(/\/guardian(\?|$)/);
  await expect(page.getByText('Мои дети').first()).toBeVisible();
  const section = page.getByLabel('Мои дети');
  for (const name of ['Заявить', 'Сохранить', 'Отметить']) {
    await expect(section.getByRole('button', { name }).first()).toHaveCount(0);
  }
});
