/** Role smoke: coach workflow, admin grants via UI, athlete/referee scoping.
 *  Runs against the live dev stack (backend :8000 + vite :5173).
 *  A pre-promoted admin (rolesmoke-admin@kwf.org / secret123) must exist.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8000';
// Seeded admin (e2e global-setup runs seed.py): full access for grant flows.
const ADMIN = { email: 'admin@kwf.org', password: 'admin123' };
const uid = `role${Date.now() % 100000}`;

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

async function registerAPI(request: APIRequestContext, email: string, role: string) {
  const r = await request.post(`${API}/api/auth/register`, {
    data: { email, password: 'secret123', full_name: `RS ${role}`, role },
  });
  expect(r.ok()).toBeTruthy();
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/me');
  // after logout the form always resets to the login tab
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').first().getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Мои турниры')).toBeVisible();
}

test('coach cabinet: my athletes empty state, /organizer denied without grant', async ({ page }) => {
  const email = `${uid}coach1@kwf.org`;
  await page.goto('/me');
  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.getByPlaceholder('Имя').fill('Coach One');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill('secret123');
  await page.getByRole('combobox').selectOption('coach');
  await page.locator('form').first().getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByText('Мои турниры')).toBeVisible();
  await expect(page.getByText('Мои спортсмены')).toBeVisible();
  await expect(page.getByText('Пока нет спортсменов')).toBeVisible();
  await page.goto('/organizer');
  await expect(page.getByText('Нет доступа')).toBeVisible();
});

test('coach edits own athlete via UI, organizer flow unaffected', async ({ page, request }) => {
  const email = `${uid}coach2@kwf.org`;
  await registerAPI(request, email, 'coach');
  const token = await apiLogin(request, email, 'secret123');
  const H = { Authorization: `Bearer ${token}` };
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: H, data: { first_name: 'RS', last_name: 'Kid', gender: 'male', birth_year: 2010, weight_kg: 40, country: 'KZ' },
  })).json()).id;
  await uiLogin(page, email, 'secret123');
  await expect(page.getByText('RS Kid')).toBeVisible();
  await page.goto(`/athletes/${aid}`);
  await page.getByRole('button', { name: 'Редактировать' }).click();
  await page.getByPlaceholder('кг').fill('41');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
});

test('admin grants tournaments.create+manage via UI, coach creates own tournament', async ({ page, request }) => {
  const email = `${uid}coach3@kwf.org`;
  await registerAPI(request, email, 'coach');
  // admin grants via Users directory editor
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/users');
  await page.getByPlaceholder('Поиск…').fill(email);
  // NOTE: the row edit button carries aria-label=user-email (a11y: rows stay
  // distinguishable), so select by email, not by the visual '✎' glyph.
  await page.getByRole('button', { name: email }).first().click();
  await page.locator('label', { hasText: 'Создание турниров' }).locator('input[type=checkbox]').check();
  await page.locator('label', { hasText: 'Управление своими' }).locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  // coach creates tournament in the wizard
  // NOTE: logout lives in the cabinet (/me) — admin/users and denied pages
  // have no 'Выйти' button, so go there first.
  await page.goto('/me');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await uiLogin(page, email, 'secret123');
  await page.goto('/organizer');
  await expect(page.getByRole('button', { name: 'Создать турнир' })).toBeVisible();
  await page.getByPlaceholder('Заголовок').fill(`RS Cup ${uid}`);
  await page.getByRole('button', { name: 'Создать турнир' }).click();
  const openLink = page.getByRole('link', { name: 'Открыть турнир →' });
  await expect(openLink).toBeVisible();
  await openLink.click();
  await expect(page).toHaveURL(/\/tournaments\/\d+$/);
  const ownTid = Number(page.url().match(/\/tournaments\/(\d+)$/)![1]);
  // ...but a foreign tournament stays forbidden via API. NOTE: exclude the
  // just-created own tournament — picking it would (correctly) return 200.
  const token = await apiLogin(request, email, 'secret123');
  const list = await (await request.get(`${API}/api/tournaments`)).json();
  const foreign = list.items.find((t: { created_by: number; id: number }) => t.id !== ownTid && t.created_by !== null);
  if (foreign) {
    const r = await request.post(`${API}/api/tournaments/${foreign.id}/categories`, {
      headers: { Authorization: `Bearer ${token}` }, data: { name: 'RS Foreign', gender: 'male' },
    });
    expect(r.status()).toBe(403);
  }
});

test('athlete: no edit button, no organizer actions; referee: judge access', async ({ page, request }) => {
  const aEmail = `${uid}ath@kwf.org`;
  const rEmail = `${uid}ref@kwf.org`;
  await registerAPI(request, aEmail, 'athlete');
  await registerAPI(request, rEmail, 'referee');
  const aToken = await apiLogin(request, aEmail, 'secret123');
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: { Authorization: `Bearer ${aToken}` },
    data: { first_name: 'RS', last_name: 'View', gender: 'male', birth_year: 2010, weight_kg: 40 },
  })).status());
  expect(aid).toBe(403); // athletes cannot create athletes at all
  await uiLogin(page, aEmail, 'secret123');
  // NOTE: scoped to <main> — the global footer always links to /organizer
  // ('Создать турнир'), which is navigation, not an afforded action.
  await expect(page.locator('main').getByText('Создать турнир')).toHaveCount(0);
  await expect(page.locator('main').getByText('Судить')).toHaveCount(0);
  await page.goto('/organizer');
  await expect(page.getByText('Нет доступа')).toBeVisible();
  // NOTE: logout lives in the cabinet (/me), not on the denied page.
  await page.goto('/me');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await uiLogin(page, rEmail, 'secret123');
  await expect(page.getByText('Судить')).toBeVisible();
  await page.goto('/referee');
  await expect(page).toHaveURL(/\/referee$/);
});
