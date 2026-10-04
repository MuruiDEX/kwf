/** Wave 4 registration UX: athlete self-apply, coach bulk, organizer approval.
 *
 *  Each test is SELF-CONTAINED (own tournament/users via API) so failures
 *  never cascade and any test can run alone. Auth budget stays minimal by
 *  reusing the seeded organizer (no registration needed for org actions).
 *  A starting cooldown keeps us out of the previous file's rate window.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8000';
const ORG = { email: 'organizer@kwf.org', password: 'organizer123' };
const uid = `wave4${Date.now() % 100000}`;

test.beforeAll(async () => {
  await new Promise((r) => setTimeout(r, 65_000));
});

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  if (!r.ok()) {
    console.log('LOGIN FAILED:', email, r.status(), await r.text());
  }
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

async function registerAPI(request: APIRequestContext, email: string, role: string) {
  const r = await request.post(`${API}/api/auth/register`, {
    data: { email, password: 'secret123', full_name: `W4 ${role}`, role },
  });
  if (!r.ok()) {
    console.log('REGISTER FAILED:', r.status(), await r.text());
  }
  expect(r.ok()).toBeTruthy();
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/me');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').first().getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Мои турниры')).toBeVisible();
}

async function mkTournament(request: APIRequestContext, headers: Record<string, string>, name: string) {
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers, data: { name, city: 'A', country: 'KZ', start_date: '2026-12-01', tatami_count: 1 },
  })).json()).id as number;
  const cat = (await (await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers, data: { name: 'M70', gender: 'male', age_min: 18, age_max: 40, weight_min: 60, weight_max: 70 },
  })).json()).id as number;
  return { tid, cat };
}

test('athlete claims profile, applies, sees status, withdraws', async ({ page, request }) => {
  const athEmail = `${uid}a1@kwf.org`;
  await registerAPI(request, athEmail, 'athlete');
  const orgToken = await apiLogin(request, ORG.email, ORG.password);
  const H = { Authorization: `Bearer ${orgToken}` };
  const { tid } = await mkTournament(request, H, `W4 Cup ${uid}a`);
  const kidAid = (await (await request.post(`${API}/api/athletes`, {
    headers: H, data: { first_name: 'W4', last_name: 'Kid', gender: 'male', birth_year: 2000, weight_kg: 68, country: 'KZ' },
  })).json()).id as number;

  await uiLogin(page, athEmail, 'secret123');
  // claim the profile
  await page.goto(`/athletes/${kidAid}`);
  await page.getByRole('button', { name: 'Это я' }).click();
  await expect(page.getByText('Мой профиль')).toBeVisible();
  // apply from the tournament page: fit badge + apply + approved status
  await page.goto(`/tournaments/${tid}`);
  await expect(page.getByText('Подходит').first()).toBeVisible();
  await page.getByRole('button', { name: 'Подать заявку' }).first().click();
  await expect(page.getByText('Принята').first()).toBeVisible({ timeout: 15000 });
  // withdraw from the cabinet
  await page.goto('/me');
  await expect(page.getByText('Мои заявки')).toBeVisible();
  await page.getByRole('button', { name: 'Отозвать' }).first().click();
  await expect(page.getByText('Отозвана').first()).toBeVisible({ timeout: 15000 });
});

test('coach bulk-registers own athletes in one go', async ({ page, request }) => {
  const coachEmail = `${uid}c1@kwf.org`;
  await registerAPI(request, coachEmail, 'coach');
  const coachToken = await apiLogin(request, coachEmail, 'secret123');
  const CH = { Authorization: `Bearer ${coachToken}` };
  const names = ['BulkA', 'BulkB'];
  for (const last of names) {
    const r = await request.post(`${API}/api/athletes`, {
      headers: CH, data: { first_name: 'W4', last_name: last, gender: 'male', birth_year: 2000, weight_kg: 68, country: 'KZ' },
    });
    expect(r.ok()).toBeTruthy();
  }
  const orgToken = await apiLogin(request, ORG.email, ORG.password);
  const { tid } = await mkTournament(request, { Authorization: `Bearer ${orgToken}` }, `W4 Cup ${uid}c`);

  await uiLogin(page, coachEmail, 'secret123');
  const section = page.getByRole('region', { name: 'Заявка на турнир' });
  await expect(section).toBeVisible();
  await section.getByLabel('Турнир').selectOption(String(tid));
  await expect(section.getByLabel('Турнир')).toHaveValue(String(tid));
  for (const last of names) {
    await section.getByRole('checkbox', { name: `W4 ${last}` }).check();
  }
  await section.getByRole('button', { name: /Заявить/ }).click();
  await expect(section.getByText('2 ok', { exact: false })).toBeVisible({ timeout: 15000 });
  // registered athletes move to the "already" panel, not the selectable list
  await expect(section.getByText('Уже заявлены (2)')).toBeVisible();
});

test('B6: athlete sees approval notification in cabinet', async ({ page, request }) => {
  const athEmail = `${uid}b6@kwf.org`;
  await registerAPI(request, athEmail, 'athlete');
  const athToken = await apiLogin(request, athEmail, 'secret123');
  const AH = { Authorization: `Bearer ${athToken}` };
  const orgToken = await apiLogin(request, ORG.email, ORG.password);
  const H = { Authorization: `Bearer ${orgToken}` };
  const { tid, cat } = await mkTournament(request, H, `W4 Cup ${uid}b6`);
  const kidAid = (await (await request.post(`${API}/api/athletes`, {
    headers: H, data: { first_name: 'W4', last_name: 'B6Kid', gender: 'male', birth_year: 2000, weight_kg: 68, country: 'KZ' },
  })).json()).id as number;
  await request.post(`${API}/api/athletes/${kidAid}/claim`, { headers: AH });
  const rid = (await (await request.post(`${API}/api/tournaments/${tid}/registrations`, {
    headers: AH, data: { athlete_id: kidAid, category_id: cat },
  })).json()).id as number;
  await uiLogin(page, athEmail, 'secret123');
  await request.post(`${API}/api/tournaments/${tid}/registrations/${rid}/status`, {
    headers: H, data: { status: 'rejected' },
  });
  await page.goto('/me');
  await expect(page.getByText('отклонена').first()).toBeVisible({ timeout: 15000 });
});

test('organizer filters pending and approves', async ({ page, request }) => {
  const orgToken = await apiLogin(request, ORG.email, ORG.password);
  const H = { Authorization: `Bearer ${orgToken}` };
  const { tid, cat } = await mkTournament(request, H, `W4 Cup ${uid}o`);
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: H, data: { first_name: 'W4', last_name: 'Org', gender: 'male', birth_year: 2000, weight_kg: 68, country: 'KZ' },
  })).json()).id as number;
  const rid = (await (await request.post(`${API}/api/tournaments/${tid}/registrations`, {
    headers: H, data: { athlete_id: aid, category_id: cat },
  })).json()).id as number;
  await request.post(`${API}/api/tournaments/${tid}/registrations/${rid}/status`, {
    headers: H, data: { status: 'pending' },
  });

  await uiLogin(page, ORG.email, ORG.password);
  await page.goto(`/tournaments/${tid}?tab=participants`);
  await page.getByLabel('Статус заявок').selectOption('pending');
  await expect(page.getByText('W4 Org').first()).toBeVisible();
  await page.getByRole('button', { name: '✓' }).first().click();
  // approved rows leave the pending filter: the row disappears, ✓ confirms
  await expect(page.getByText('W4 Org')).toHaveCount(0, { timeout: 15000 });
});
