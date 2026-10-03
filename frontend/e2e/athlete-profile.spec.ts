/** B3 athlete profile: rank/stats/recent/medals, empty athlete, mobile + dark.
 *  Uses ONLY public pages + API setup (organizer token, seeded admin org).
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8000';

async function orgToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, {
    data: { email: 'organizer@kwf.org', password: 'organizer123' },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/me');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').first().getByRole('button', { name: 'Войти' }).click();
  // login form disappears on success (cabinet renders instead)
  await expect(page.getByPlaceholder('Email')).toHaveCount(0, { timeout: 15000 });
}

/** B5 fixture: coach-owned athlete with an organizer-issued diploma. */
async function athleteWithDiploma(request: APIRequestContext, tag: string) {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const coachEmail = `b5e2e${tag}@kwf.org`;
  await request.post(`${API}/api/auth/register`, {
    data: { email: coachEmail, password: 'secret123', full_name: 'B5 Coach', role: 'coach' },
  });
  const coachLogin = await request.post(`${API}/api/auth/login`, {
    data: { email: coachEmail, password: 'secret123' },
  });
  const CH = { Authorization: `Bearer ${(await coachLogin.json()).token}` };
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: CH,
    data: { first_name: 'B5E', last_name: `Doc${tag}`, gender: 'male', birth_year: 2014, weight_kg: 35, country: 'KZ' },
  })).json()).id as number;
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers: H, data: { name: `B5 Doc Cup ${tag}`, city: 'Astana', country: 'KZ', start_date: '2026-12-20' },
  })).json()).id as number;
  const cat = (await (await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: H, data: { name: 'U12', gender: 'male', age_min: 10, age_max: 12, weight_min: 30, weight_max: 40 },
  })).json()).id as number;
  await request.post(`${API}/api/tournaments/${tid}/registrations`, {
    headers: CH, data: { athlete_id: aid, category_id: cat },
  });
  const code = (await (await request.post(`${API}/api/documents/issue`, {
    headers: H, params: { athlete_id: aid, tournament_id: tid, kind: 'diploma', place: '1', category: 'U12' },
  })).json()).code as string;
  return { aid, code, coachEmail };
}

async function finishAll(request: APIRequestContext, H: Record<string, string>, tid: number, champ: number) {
  await request.post(`${API}/api/tournaments/${tid}/brackets/generate`, { headers: H });
  for (let pass = 0; pass < 2; pass++) {
    const br = (await (await request.get(`${API}/api/tournaments/${tid}/brackets`)).json())[0].matches;
    for (const m of br) {
      if (m.status !== 'bye' && m.status !== 'finished' && m.a && m.b) {
        const w = [m.a, m.b].includes(champ) ? champ : m.a;
        await request.post(`${API}/api/tournaments/matches/${m.id}/finish`, {
          headers: H, data: { winner_id: w, score_a: 1, score_b: 0 },
        });
      }
    }
  }
  for (const st of ['registration', 'live', 'finished']) {
    await request.post(`${API}/api/tournaments/${tid}/status`, { headers: H, data: { status: st } });
  }
}

test('champion profile shows rank, stats, recent and medals', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const tag = Date.now() % 100000;
  const aids: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = await (await request.post(`${API}/api/athletes`, {
      headers: H,
      data: { first_name: 'B3E', last_name: `Champ${tag}${i}`, gender: 'male', birth_year: 2014, weight_kg: 35, country: 'KZ' },
    })).json();
    aids.push(a.id);
  }
  const tname = `B3 E2E Cup ${tag}`;
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers: H, data: { name: tname, city: 'Astana', country: 'KZ', start_date: '2026-12-20' },
  })).json()).id as number;
  const cat = (await (await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: H, data: { name: 'U12', gender: 'male', age_min: 10, age_max: 12, weight_min: 30, weight_max: 40 },
  })).json()).id as number;
  for (const aid of aids) {
    await request.post(`${API}/api/tournaments/${tid}/registrations`, {
      headers: H, data: { athlete_id: aid, category_id: cat },
    });
  }
  await finishAll(request, H, tid, aids[0]);

  await page.goto(`/athletes/${aids[0]}`);
  await expect(page.getByTestId('athlete-stats')).toContainText('#');
  await expect(page.getByTestId('athlete-stats')).toContainText('100%');
  await expect(page.getByTestId('athlete-medals')).toContainText('🥇 1');
  const hit = page.getByTestId('athlete-recent-hit').filter({ hasText: tname });
  await expect(hit).toBeVisible({ timeout: 15000 });
  await expect(hit).toContainText('#1');
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/tournaments/${tid}$`));
});

test('empty athlete renders zeros without crash', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const tag = Date.now() % 100000;
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: H,
    data: { first_name: 'B3E', last_name: `Fresh${tag}`, gender: 'male', birth_year: 2016, weight_kg: 30, country: 'KZ' },
  })).json()).id as number;
  await page.goto(`/athletes/${aid}`);
  await expect(page.getByTestId('athlete-stats')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('athlete-medals')).toContainText('🥇 0');
  await expect(page.getByTestId('athlete-recent')).toHaveCount(0);
  await expect(page.getByText('Пока нет выступлений.')).toBeVisible();
});

test('B5: foreign user sees no document codes, page stays usable', async ({ page, request }) => {
  const tag = Date.now() % 100000;
  const { aid, code } = await athleteWithDiploma(request, tag);
  const stranger = `b5e2estranger${tag}@kwf.org`;
  await request.post(`${API}/api/auth/register`, {
    data: { email: stranger, password: 'secret123', full_name: 'B5 Stranger', role: 'coach' },
  });
  await uiLogin(page, stranger, 'secret123');
  await page.goto(`/athletes/${aid}`);
  // public profile still renders fine...
  await expect(page.getByTestId('athlete-stats')).toBeVisible({ timeout: 15000 });
  // ...but no document section and no leaked code anywhere on the page
  await expect(page.getByRole('heading', { name: 'Документы' })).toHaveCount(0);
  await expect(page.getByText(code.slice(0, 6))).toHaveCount(0);
});

test('B5: owner coach still sees own athlete documents', async ({ page, request }) => {
  const tag = Date.now() % 100000;
  const { aid, code, coachEmail } = await athleteWithDiploma(request, tag);
  await uiLogin(page, coachEmail, 'secret123');
  await page.goto(`/athletes/${aid}`);
  await expect(page.getByTestId('athlete-stats')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(code.slice(0, 6))).toBeVisible();
});

test('athlete profile mobile 360px + dark has no overflow', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const tag = Date.now() % 100000;
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: H,
    data: { first_name: 'B3E', last_name: `Mob${tag}`, gender: 'male', birth_year: 2014, weight_kg: 35, country: 'KZ' },
  })).json()).id as number;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/athletes/${aid}`);
  await expect(page.getByTestId('athlete-stats')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    localStorage.setItem('kwf-theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await page.reload();
  await expect(page.getByTestId('athlete-stats')).toBeVisible();
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
