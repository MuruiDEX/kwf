/** Role smoke: coach workflow, admin grants via UI, athlete/referee scoping.
 *  Runs against the live dev stack (backend :8000 + vite :5173).
 *  A pre-promoted admin (rolesmoke-admin@kwf.org / secret123) must exist.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8000';
// Seeded admin (e2e global-setup runs seed.py): full access for grant flows.
const ADMIN = { email: 'admin@kwf.org', password: 'admin123' };
const uid = `role${Date.now() % 100000}`;

// Infra pacing: the previous file's auth burst shares our per-IP sliding
// window (10 login POSTs/60s); without a gap, this file's ~4 logins land in
// the same window and trip 429. Same convention as multirole.beforeAll.
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
    data: { email, password: 'secret123', full_name: `RS ${role}`, role },
  });
  if (!r.ok()) {
    console.log('REGISTER FAILED:', r.status(), await r.text());
  }
  expect(r.ok()).toBeTruthy();
}

async function uiLogin(page: Page, email: string, password: string, expected: RegExp = /\/(athlete|coach|organizer|referee|admin|guardian)(\?|$)/) {
  await page.goto('/me');
  // after logout the form always resets to the login tab
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').first().getByRole('button', { name: 'Войти' }).click();
  // Role UX 3.0: /me dispatches to the role home, not a universal cabinet.
  await expect(page).toHaveURL(expected);
}

async function uiLogout(page: Page) {
  await page.goto('/me');
  await page.locator('header').getByRole('button', { name: 'Профиль' }).click();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
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
  // coach lands on the team-oriented home (not a universal cabinet)
  await expect(page).toHaveURL(/\/coach(\?|$)/);
  await expect(page.getByText('Мои спортсмены').first()).toBeVisible();
  await expect(page.getByText('Пока нет спортсменов').first()).toBeVisible();
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
  // NOTE: scoped to the athletes region — the spravki section below lists
  // the same athlete in its <select>, which would make a page-wide lookup
  // ambiguous. Invariant unchanged: the athlete is visible in the cabinet.
  await expect(page.getByRole('region', { name: 'Мои спортсмены' }).getByText('RS Kid')).toBeVisible();
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
  // coach creates tournament via the organizer home (create tab)
  await uiLogout(page);
  await uiLogin(page, email, 'secret123', /\/coach(\?|$)/);
  await page.goto('/organizer');
  await page.getByRole('tab', { name: 'Создать турнир' }).click();
  await page.getByPlaceholder('Заголовок').fill(`RS Cup ${uid}`);
  await page.getByRole('button', { name: 'Создать турнир', exact: true }).click();
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
  await uiLogin(page, aEmail, 'secret123', /\/athlete(\?|$)/);
  // NOTE: scoped to <main> — the global footer always links to /organizer
  // ('Создать турнир'), which is navigation, not an afforded action.
  await expect(page.locator('main').getByText('Создать турнир')).toHaveCount(0);
  await page.goto('/organizer');
  await expect(page.getByText('Нет доступа')).toBeVisible();
  await uiLogout(page);
  await uiLogin(page, rEmail, 'secret123', /\/referee(\?|$)/);
  // referee lands in the operational workspace (queue, not a stats cabinet)
  await expect(page.getByText('Очередь боёв').first()).toBeVisible();
  await page.goto('/referee');
  await expect(page).toHaveURL(/\/referee$/);
});

// Infra pacing, NOT a state wait and NOT a test: this file performs
// ~5 registrations + ~8 logins against the 10/60s per-IP auth limits.
// The gap keeps tournament.spec.ts out of the same sliding window.
// Production limits, workers and auth logic are untouched.
test.afterAll(async () => {
  await new Promise((r) => setTimeout(r, 65_000));
});
