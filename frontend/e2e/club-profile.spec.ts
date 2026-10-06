/** B2 club profile: header, roster (+show more), upcoming, results,
 *  schedule empty state, club deep-links, mobile + dark.
 *  Seed data: "Kyokushin Almaty" club with athletes (no sessions).
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

test('seeded club profile renders all sections', async ({ page }) => {
  await page.goto('/clubs');
  await page.getByRole('link', { name: 'Kyokushin Almaty' }).click();
  await expect(page).toHaveURL(/\/clubs\/\d+$/);
  await expect(page.getByTestId('club-profile')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kyokushin Almaty' })).toBeVisible();
  // roster table with seeded athletes (seed.py: Ayan Serik, Ivan Ivanov, ...)
  await expect(page.getByRole('link', { name: 'Ayan Serik' })).toBeVisible({ timeout: 15000 });
  // report downloads stay
  await expect(page.getByRole('link', { name: /PDF/ })).toBeVisible();
  // no sessions seeded -> empty schedule state (not a crash)
  await expect(page.getByText('Занятий пока нет.')).toBeVisible();
});

test('roster show-more paginates a big club', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const cname = `B2 E2E Big ${Date.now() % 100000}`;
  const cid = (await (await request.post(`${API}/api/clubs`, {
    headers: H, data: { name: cname, country: 'KZ', city: 'Astana', coach_name: 'E2E' },
  })).json()).id as number;
  for (let i = 0; i < 55; i++) {
    await request.post(`${API}/api/athletes`, {
      headers: H,
      data: { first_name: 'E2E', last_name: `Big${i}`, gender: 'male', birth_year: 2014, weight_kg: 35, country: 'KZ', club_id: cid },
    });
  }
  await page.goto(`/clubs/${cid}`);
  await expect(page.getByTestId('club-profile')).toBeVisible();
  const more = page.getByTestId('club-roster-more');
  await expect(more).toBeVisible({ timeout: 15000 });
  await expect(more).toContainText('50/55');
  await more.click();
  await expect(more).toHaveCount(0); // 55 <= 100: all loaded
});

test('upcoming section links to the tournament', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const cname = `B2 E2E Up ${Date.now() % 100000}`;
  const cid = (await (await request.post(`${API}/api/clubs`, {
    headers: H, data: { name: cname, country: 'KZ', city: 'Astana', coach_name: 'E2E' },
  })).json()).id as number;
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: H,
    data: { first_name: 'E2E', last_name: 'UpKid', gender: 'male', birth_year: 2014, weight_kg: 35, country: 'KZ', club_id: cid },
  })).json()).id as number;
  const tname = `B2 E2E Future ${Date.now() % 100000}`;
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers: H, data: { name: tname, city: 'Astana', country: 'KZ', start_date: '2026-12-20' },
  })).json()).id as number;
  const cat = (await (await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: H, data: { name: 'U12', gender: 'male', age_min: 10, age_max: 12, weight_min: 30, weight_max: 40 },
  })).json()).id as number;
  await request.post(`${API}/api/tournaments/${tid}/registrations`, {
    headers: H, data: { athlete_id: aid, category_id: cat },
  });
  await page.goto(`/clubs/${cid}`);
  const hit = page.getByTestId('club-upcoming-hit').filter({ hasText: tname });
  await expect(hit).toBeVisible({ timeout: 15000 });
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/tournaments/${tid}$`));
});

test('participants row links to the club profile', async ({ page, request }) => {
  const token = await orgToken(request);
  const H = { Authorization: `Bearer ${token}` };
  const cname = `B2 E2E Link ${Date.now() % 100000}`;
  const cid = (await (await request.post(`${API}/api/clubs`, {
    headers: H, data: { name: cname, country: 'KZ', city: 'Astana', coach_name: 'E2E' },
  })).json()).id as number;
  const aid = (await (await request.post(`${API}/api/athletes`, {
    headers: H,
    data: { first_name: 'E2E', last_name: 'LinkKid', gender: 'male', birth_year: 2014, weight_kg: 35, country: 'KZ', club_id: cid },
  })).json()).id as number;
  const tname = `B2 E2E LinkT ${Date.now() % 100000}`;
  const tid = (await (await request.post(`${API}/api/tournaments`, {
    headers: H, data: { name: tname, city: 'Astana', country: 'KZ', start_date: '2026-12-21' },
  })).json()).id as number;
  const cat = (await (await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: H, data: { name: 'U12', gender: 'male', age_min: 10, age_max: 12, weight_min: 30, weight_max: 40 },
  })).json()).id as number;
  await request.post(`${API}/api/tournaments/${tid}/registrations`, {
    headers: H, data: { athlete_id: aid, category_id: cat },
  });
  await page.goto(`/tournaments/${tid}?tab=participants`);
  await page.getByRole('link', { name: cname }).first().click();
  await expect(page).toHaveURL(new RegExp(`/clubs/${cid}$`));
  await expect(page.getByTestId('club-profile')).toBeVisible();
});

test('club profile mobile 360px + dark has no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/clubs');
  await page.getByRole('link', { name: 'Kyokushin Almaty' }).click();
  await expect(page.getByTestId('club-profile')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('kwf-theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await page.reload();
  await expect(page.getByTestId('club-profile')).toBeVisible();
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
