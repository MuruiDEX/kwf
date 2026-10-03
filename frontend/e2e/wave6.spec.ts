/** Wave 6 controlled correction: organizer fixes one pending R1 pair in the UI;
 *  finished fights stay read-only. Self-contained file (own tournament via API,
 *  seeded organizer, no new users except none). Starting cooldown keeps us out
 *  of the previous file's rate window.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8000';
const ORG = { email: 'organizer@kwf.org', password: 'organizer123' };
const uid = `wave6${Date.now() % 100000}`;

test.beforeAll(async () => {
  await new Promise((r) => setTimeout(r, 65_000));
});

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/me');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').first().getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Мои турниры')).toBeVisible();
}

test('organizer corrects a pending pair, finished stays read-only', async ({ page, request }) => {
  const orgToken = await apiLogin(request, ORG.email, ORG.password);
  const H = { Authorization: `Bearer ${orgToken}` };
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers: H, data: { name: `W6 Cup ${uid}`, city: 'A', country: 'KZ', start_date: '2026-12-01', tatami_count: 1 },
  })).json()).id as number;
  const cat = (await (await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: H, data: { name: 'M70', gender: 'male', age_min: 18, age_max: 40, weight_min: 60, weight_max: 70 },
  })).json()).id as number;
  const aids: number[] = [];
  for (const last of ['A0', 'A1', 'A2', 'A3']) {
    const aid = (await (await request.post(`${API}/api/athletes`, {
      headers: H, data: { first_name: 'W6', last_name: last, gender: 'male', birth_year: 2000, weight_kg: 68, country: 'KZ' },
    })).json()).id as number;
    aids.push(aid);
    await request.post(`${API}/api/tournaments/${tid}/registrations`, {
      headers: H, data: { athlete_id: aid, category_id: cat },
    });
  }
  await request.post(`${API}/api/tournaments/${tid}/brackets/generate`, { headers: H });
  // spare athlete registered AFTER generation: in-category, in no bracket slot
  const spare = (await (await request.post(`${API}/api/athletes`, {
    headers: H, data: { first_name: 'W6', last_name: 'Spare', gender: 'male', birth_year: 2000, weight_kg: 68, country: 'KZ' },
  })).json()).id as number;
  await request.post(`${API}/api/tournaments/${tid}/registrations`, {
    headers: H, data: { athlete_id: spare, category_id: cat },
  });

  await uiLogin(page, ORG.email, ORG.password);
  await page.goto(`/tournaments/${tid}?tab=brackets`);
  const correctBtns = page.getByRole('button', { name: 'Исправить пару' });
  await expect(correctBtns).toHaveCount(2);
  // correct the first pending pair: replace side B with the spare athlete
  await correctBtns.first().click();
  await page.getByLabel('Второй участник').selectOption('W6 Spare');
  await page.getByLabel('Причина исправления').fill('seeding typo e2e');
  await page.getByRole('button', { name: 'Применить исправление' }).click();
  await expect(page.getByText('Пара исправлена')).toBeVisible({ timeout: 15000 });
  // bracket cards render raw ids (pre-existing display), so verify the new
  // pairing through the API contract instead of UI text
  const brAfter = (await (await request.get(`${API}/api/tournaments/${tid}/brackets`)).json())[0].matches as
    { id: number; a: number | null; b: number | null }[];
  expect(brAfter.some((m) => m.a === spare || m.b === spare)).toBe(true);
  // finish one fight via API: its card must lose the correction affordance
  const br = (await (await request.get(`${API}/api/tournaments/${tid}/brackets`)).json())[0].matches as
    { id: number; round: number; status: string; a: number; b: number }[];
  const semi = br.find((m) => m.round === 1 && m.status !== 'bye')!;
  await request.post(`${API}/api/tournaments/matches/${semi.id}/finish`, {
    headers: H, data: { winner_id: semi.a, score_a: 1, score_b: 0 },
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Исправить пару' })).toHaveCount(1);
});
