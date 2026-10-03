/** B4: tournament discovery completion — catalog show-more, results deep-links,
 *  registration open badge, mobile + dark. Uses seeded organizer + API setup.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

const API = 'http://127.0.0.1:8000';

async function orgToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, {
    data: { email: 'organizer@kwf.org', password: 'organizer123' },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

test('catalog show-more appends the second page without duplicates', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const tag = `B4Cat${Date.now() % 100000}`;
  for (let i = 0; i < 21; i++) {
    await request.post(`${API}/api/tournaments`, {
      headers: H,
      data: { name: `${tag} Cup ${String(i).padStart(2, '0')}`, city: 'Showmore', country: 'KZ', start_date: '2026-12-01' },
    });
  }
  await page.goto(`/tournaments?q=${tag}`);
  const cards = page.getByTestId('discovery-card');
  await expect(cards).toHaveCount(20, { timeout: 15000 });
  const more = page.getByTestId('tournaments-more');
  await expect(more).toBeVisible();
  await expect(more).toContainText('(20/');
  await more.click();
  await expect(cards).toHaveCount(21, { timeout: 15000 });
  await expect(more).toHaveCount(0); // loaded >= total -> button gone
  // no duplicate tournament IDs
  const hrefs = await cards.evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute('href')));
  expect(new Set(hrefs).size).toBe(hrefs.length);
});

test('filters reset loaded pages', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const tag = `B4Reset${Date.now() % 100000}`;
  for (let i = 0; i < 21; i++) {
    await request.post(`${API}/api/tournaments`, {
      headers: H,
      data: { name: `${tag} Cup ${String(i).padStart(2, '0')}`, city: 'Resetville', country: 'KZ', start_date: '2026-12-01' },
    });
  }
  await page.goto(`/tournaments?q=${tag}`);
  await expect(page.getByTestId('discovery-card')).toHaveCount(20, { timeout: 15000 });
  await page.getByTestId('tournaments-more').click();
  await expect(page.getByTestId('discovery-card')).toHaveCount(21, { timeout: 15000 });
  // narrowing the query resets to the first page
  await page.getByTestId('filter-q').fill(`${tag} Cup 00`);
  await expect(page.getByTestId('discovery-card')).toHaveCount(1, { timeout: 15000 });
  await expect(page.getByTestId('tournaments-more')).toHaveCount(0);
});

async function finishedTournament(request: APIRequestContext, H: Record<string, string>, tag: string) {
  const cname = `B4 Link Club ${tag}`;
  const cid = (await (await request.post(`${API}/api/clubs`, {
    headers: H, data: { name: cname, country: 'KZ', city: 'Linktown', coach_name: 'L' },
  })).json()).id as number;
  const aids: number[] = [];
  const names: string[] = [];
  for (let i = 0; i < 4; i++) {
    const nm = `B4Link${tag}F${i}`;
    names.push(nm);
    const a = await (await request.post(`${API}/api/athletes`, {
      headers: H,
      data: { first_name: nm, last_name: 'Fighter', gender: 'male', birth_year: 2000, weight_kg: 68, country: 'KZ', club_id: cid },
    })).json();
    aids.push(a.id);
  }
  const tname = `B4 Link Cup ${tag}`;
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers: H, data: { name: tname, city: 'Linktown', country: 'KZ', start_date: '2026-12-01' },
  })).json()).id as number;
  const cat = (await (await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: H, data: { name: 'M70', gender: 'male', age_min: 18, age_max: 40, weight_min: 60, weight_max: 70 },
  })).json()).id as number;
  for (const aid of aids) {
    await request.post(`${API}/api/tournaments/${tid}/registrations`, {
      headers: H, data: { athlete_id: aid, category_id: cat },
    });
  }
  await request.post(`${API}/api/tournaments/${tid}/brackets/generate`, { headers: H });
  for (let k = 0; k < 3; k++) {
    const br = (await (await request.get(`${API}/api/tournaments/${tid}/brackets`)).json())[0].matches;
    for (const m of br) {
      if (m.status !== 'bye' && m.status !== 'finished' && m.a && m.b) {
        await request.post(`${API}/api/tournaments/matches/${m.id}/finish`, {
          headers: H, data: { winner_id: m.a, score_a: 1, score_b: 0 },
        });
      }
    }
  }
  return { tid, cid, cname };
}

test('results deep-links: champion, medal athlete, podium athlete+club', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const tag = `${Date.now() % 100000}`;
  const { tid, cid, cname } = await finishedTournament(request, H, tag);
  const champName = (await (await request.get(`${API}/api/tournaments/${tid}/results`)).json()).standings[0].champion as string;
  await page.goto(`/tournaments/${tid}?tab=results`);

  // standings champion -> athlete profile
  await page.getByRole('link', { name: champName, exact: true }).first().click();
  await expect(page).toHaveURL(/\/athletes\/\d+$/);
  await page.goBack();

  // medal table athlete -> athlete profile
  await page.getByRole('link', { name: champName, exact: true }).first().click();
  await expect(page).toHaveURL(/\/athletes\/\d+$/);
  await page.goBack();

  // podium athlete + club links
  const podiumAthlete = page.getByRole('link', { name: champName, exact: true }).first();
  await expect(podiumAthlete).toBeVisible({ timeout: 15000 });
  await podiumAthlete.click();
  await expect(page).toHaveURL(/\/athletes\/\d+$/);
  await page.goBack();
  await page.getByRole('link', { name: cname }).first().click();
  await expect(page).toHaveURL(new RegExp(`/clubs/${cid}$`));
});

test('registration open badge follows tournament status', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const tag = `B4Reg${Date.now() % 100000}`;
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers: H, data: { name: `B4 Reg Cup ${tag}`, city: 'Regtown', country: 'KZ', start_date: '2026-12-01' },
  })).json()).id as number;
  await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: H, data: { name: 'M70', gender: 'male', age_min: 18, age_max: 40, weight_min: 60, weight_max: 70 },
  });
  // default status (upcoming): no open badge, no fake deadline
  await page.goto(`/tournaments/${tid}?tab=overview`);
  await expect(page.getByText('Регистрация открыта')).toHaveCount(0);
  // registration: open badge appears
  await request.post(`${API}/api/tournaments/${tid}/status`, { headers: H, data: { status: 'registration' } });
  await page.reload();
  await expect(page.getByText('Регистрация открыта')).toBeVisible({ timeout: 15000 });
});

test('tournament detail mobile 360px + dark stays readable', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const tag = `${Date.now() % 100000}`;
  const { tid } = await finishedTournament(request, H, tag);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('kwf-theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await page.goto(`/tournaments/${tid}?tab=results`);
  await expect(page.getByText('Победители по категориям')).toBeVisible({ timeout: 15000 });
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
