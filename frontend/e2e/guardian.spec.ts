/** C3 guardian cabinet: approved ward auto-selected, read-only regs/docs,
 *  revoke surfaces a safe empty state. Self-contained (own users/athlete).
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8000';
const ORG = { email: 'organizer@kwf.org', password: 'organizer123' };
const uid = `guard${Date.now() % 100000}`;

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

async function registerAPI(request: APIRequestContext, email: string, role: string): Promise<string> {
  const r = await request.post(`${API}/api/auth/register`, {
    data: { email, password: 'secret123', full_name: `G3 ${role}`, role },
  });
  expect(r.ok()).toBeTruthy();
  // register auto-logs-in and returns a token (no extra /login call needed).
  return (await r.json()).token as string;
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/me');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').first().getByRole('button', { name: 'Войти' }).click();
  // Role UX 3.0: guardian (wards, no backend role) lands on /guardian.
  await expect(page).toHaveURL(/\/guardian(\?|$)/);
}

test('guardian sees approved ward read-only, revoke empties cabinet', async ({ page, request }) => {
  const coachEmail = `${uid}coach@kwf.org`;
  const guardEmail = `${uid}guard@kwf.org`;
  const coachToken = await registerAPI(request, coachEmail, 'coach');
  const guardToken = await registerAPI(request, guardEmail, 'public');
  const orgToken = await apiLogin(request, ORG.email, ORG.password);
  const CH = { Authorization: `Bearer ${coachToken}` };
  const GH = { Authorization: `Bearer ${guardToken}` };
  const OH = { Authorization: `Bearer ${orgToken}` };

  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: CH, data: { first_name: 'Гош', last_name: `Кид${uid}`, gender: 'male', birth_year: 2015, weight_kg: 40, country: 'KZ' },
  })).json()).id as number;
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers: OH, data: { name: `G3 Cup ${uid}`, city: 'A', country: 'KZ', start_date: '2026-12-01', tatami_count: 1 },
  })).json()).id as number;
  const cat = (await (await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: OH, data: { name: 'M40', gender: 'male', age_min: 10, age_max: 12, weight_min: 30, weight_max: 45 },
  })).json()).id as number;
  await request.post(`${API}/api/tournaments/${tid}/registrations`, {
    headers: CH, data: { athlete_id: aid, category_id: cat },
  });
  const lid = (await (await request.post(`${API}/api/guardian/links`, {
    headers: GH, data: { athlete_id: aid },
  })).json()).id as number;
  expect((await request.post(`${API}/api/guardian/links/${lid}/approve`, { headers: CH })).ok()).toBeTruthy();

  await uiLogin(page, guardEmail, 'secret123');
  // guardian section with auto-selected single ward, read-only regs, docs empty
  await expect(page.getByText('Мои дети').first()).toBeVisible();
  await expect(page.getByText(`Гош Кид${uid}`).first()).toBeVisible();
  await expect(page.getByText(`G3 Cup ${uid}`).first()).toBeVisible();
  await expect(page.getByText('Нет доступных документов.')).toBeVisible();
  // read-only: no athlete/tournament mutation controls anywhere in the
  // guardian section (Guardian 2.0 adds only the benign link-request toggle)
  const guardSection = page.getByLabel('Мои дети');
  for (const name of ['Одобрить', 'Отклонить', 'Отозвать', 'Отметить', 'Сохранить', 'Заявить']) {
    await expect(guardSection.getByRole('button', { name }).first()).toHaveCount(0);
  }

  // revoke -> reload -> safe empty state, no stale ward data
  // (absence is scoped to the guardian section: the notification feed below
  // correctly keeps the revocation notice mentioning the ward's name)
  await request.delete(`${API}/api/guardian/links/${lid}`, { headers: GH });
  await page.reload();
  await expect(page.getByText('Нет связанных спортсменов')).toBeVisible();
  await expect(page.getByLabel('Мои дети').getByText(`Гош Кид${uid}`)).toHaveCount(0);

  // C5: mid-session revoke must not survive navigation either — leaving and
  // returning to the cabinet remounts and revalidates (staleTime 0), so the
  // re-approved-then-revoked ward never renders from cache.
  const lid2 = (await (await request.post(`${API}/api/guardian/links`, {
    headers: GH, data: { athlete_id: aid },
  })).json()).id as number;
  expect(await (await request.post(`${API}/api/guardian/links/${lid2}/approve`, { headers: CH })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText(`Гош Кид${uid}`).first()).toBeVisible();
  await request.delete(`${API}/api/guardian/links/${lid2}`, { headers: GH });
  await page.goto('/tournaments');
  await page.goto('/me');
  await expect(page.getByText('Нет связанных спортсменов')).toBeVisible();
  await expect(page.getByLabel('Мои дети').getByText(`Гош Кид${uid}`)).toHaveCount(0);
});
