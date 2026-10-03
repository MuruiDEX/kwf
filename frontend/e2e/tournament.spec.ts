/** Critical path: login → create → brackets → schedule → live → finish → results → diploma → verify.
 *  Data setup (category/athletes/regs) goes through the API — no UI forms exist for those;
 *  everything a user CAN click is clicked in the UI.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8000';

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  if (!r.ok()) {
    console.log('LOGIN FAILED:', email, r.status(), await r.text());
  }
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  return j.token as string;
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/me');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.locator('form').getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Мои турниры')).toBeVisible();
}

test('tournament lifecycle in the UI', async ({ page, request }) => {
  // 1. login as seeded organizer
  await uiLogin(page, 'organizer@kwf.org', 'organizer123');
  const token = await apiLogin(request, 'organizer@kwf.org', 'organizer123');
  const H = { Authorization: `Bearer ${token}` };

  // 2. create tournament in the wizard
  await page.goto('/organizer');
  await page.getByPlaceholder('Заголовок').fill('PW Cup');
  await page.getByRole('button', { name: 'Создать турнир' }).click();
  const openLink = page.getByRole('link', { name: 'Открыть турнир →' });
  await expect(openLink).toBeVisible();
  await openLink.click();
  await expect(page).toHaveURL(/\/tournaments\/\d+$/);
  const tid = page.url().match(/\/tournaments\/(\d+)/)![1];

  // 3. category + athletes + registrations via API (no UI forms exist)
  const catRes = await request.post(`${API}/api/tournaments/${tid}/categories`, {
    headers: H,
    data: { name: 'M70', gender: 'male', age_min: 18, age_max: 40, weight_min: 60, weight_max: 70 },
  });
  if (!catRes.ok()) {
    console.log('CATEGORY FAILED:', catRes.status(), await catRes.text());
  }
  expect(catRes.ok()).toBeTruthy();
  const cat = await catRes.json();
  const aids: number[] = [];
  for (let i = 0; i < 4; i++) {
    const aRes = await request.post(`${API}/api/athletes`, {
      headers: H,
      data: { first_name: 'PW', last_name: `Fighter${i}`, gender: 'male', birth_year: 2000, weight_kg: 68, country: 'KZ' },
    });
    if (!aRes.ok()) {
      console.log('ATHLETE FAILED:', aRes.status(), await aRes.text());
    }
    expect(aRes.ok()).toBeTruthy();
    const a = await aRes.json();
    aids.push(a.id);
    const regRes = await request.post(`${API}/api/tournaments/${tid}/registrations`, {
      headers: H, data: { athlete_id: a.id, category_id: cat.id },
    });
    if (!regRes.ok()) {
      console.log('REG FAILED:', regRes.status(), await regRes.text());
    }
    expect(regRes.ok()).toBeTruthy();
  }

  // 4. weigh-in via UI (first row)
  await page.goto(`/tournaments/${tid}?tab=weighin`);
  await page.locator('input[aria-label^="Вес"]').first().fill('66');
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page.getByText('✓', { exact: false }).first()).toBeVisible();

  // 5. brackets + schedule via UI overview buttons
  await page.goto(`/tournaments/${tid}?tab=overview`);
  await page.getByRole('button', { name: 'Сгенерировать сетки' }).click();
  // State-based wait (not a sleep): the generate POST is fire-and-forget from
  // the UI, and an immediate navigation can abort it in-flight. Poll the API
  // until the bracket actually lands, then assert the rendered UI as before.
  await expect.poll(async () => {
    const r = await request.get(`${API}/api/tournaments/${tid}/brackets`);
    const j = await r.json();
    return Array.isArray(j) ? j.length : 0;
  }, { timeout: 15000 }).toBeGreaterThan(0);
  await page.goto(`/tournaments/${tid}?tab=brackets`);
  await expect(page.getByText('олимпийская система').first()).toBeVisible();
  await expect(page.getByText('Финал').first()).toBeVisible();
  await page.goto(`/tournaments/${tid}?tab=overview`);
  await page.getByRole('button', { name: 'Сгенерировать расписание' }).click();

  // 6. status flow via UI: upcoming -> registration -> live
  await page.getByRole('button', { name: 'Открыть регистрацию' }).click();
  await page.getByRole('button', { name: 'Начать турнир' }).click();

  // 7. referee finishes one semifinal via UI (two-step confirm)
  const br = await (await request.get(`${API}/api/tournaments/${tid}/brackets`)).json();
  const semi = br[0].matches.find((m: { round: number; status: string }) => m.round === 1 && m.status !== 'bye');
  await page.goto('/referee');
  await page.getByLabel('ID турнира').fill(tid);
  await page.getByLabel('ID боя').fill(String(semi.id));
  await page.getByRole('button', { name: 'Победитель: Ака' }).click();
  const finishBtn = page.getByRole('button', { name: 'Завершить бой' });
  await finishBtn.click(); // arms confirm
  await finishBtn.click(); // confirms
  await expect(page.getByText('Бой завершён')).toBeVisible();

  // 8. finish the rest via API, close the tournament via UI
  const br2 = await (await request.get(`${API}/api/tournaments/${tid}/brackets`)).json();
  for (const m of br2[0].matches) {
    if (m.status !== 'bye' && m.status !== 'finished' && m.a && m.b) {
      await request.post(`${API}/api/tournaments/matches/${m.id}/finish`, {
        headers: H, data: { winner_id: m.a, score_a: 1, score_b: 0 },
      });
    }
  }
  // final appeared after semifinals — finish whatever remains (2 passes max)
  for (let k = 0; k < 2; k++) {
    const b = await (await request.get(`${API}/api/tournaments/${tid}/brackets`)).json();
    for (const m of b[0].matches) {
      if (m.status !== 'bye' && m.status !== 'finished' && m.a && m.b) {
        await request.post(`${API}/api/tournaments/matches/${m.id}/finish`, {
          headers: H, data: { winner_id: m.a, score_a: 1, score_b: 0 },
        });
      }
    }
  }
  await page.goto(`/tournaments/${tid}?tab=overview`);
  await page.getByRole('button', { name: 'Завершить турнир' }).click();
  await expect(page.getByText('Завершён').first()).toBeVisible();

  // 9. results tab shows the champion; issue a diploma; verify it
  await page.goto(`/tournaments/${tid}?tab=results`);
  await expect(page.getByText('Победители по категориям')).toBeVisible();
  await expect(page.getByText('PW Fighter0').first()).toBeVisible();
  await page.getByRole('button', { name: 'Диплом' }).first().click();
  const verifyLink = page.getByRole('link', { name: /Диплом выпущен/ });
  await expect(verifyLink).toBeVisible();
  await verifyLink.click();
  await expect(page.getByText('Документ действителен')).toBeVisible();
});

test('foreign organizer mutation is forbidden (API)', async ({ request }) => {
  // second organizer via request→approve flow
  const coachReg = await request.post(`${API}/api/auth/register`, {
    data: { email: 'pwcoach@kwf.org', password: 'pw123456', full_name: 'PW Coach', role: 'coach' },
  });
  expect([200, 400]).toContain(coachReg.status());
  const coachToken = await apiLogin(request, 'pwcoach@kwf.org', 'pw123456');
  await request.post(`${API}/api/auth/request-organizer`, {
    headers: { Authorization: `Bearer ${coachToken}` },
    data: { org_name: 'PW Org', message: 'e2e' },
  });
  const adminToken = await apiLogin(request, 'admin@kwf.org', 'admin123');
  const reqs = await (await request.get(`${API}/api/admin/organizer-requests`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  const rid = reqs.items.find((r: { org_name: string; id: number }) => r.org_name === 'PW Org').id;
  await request.post(`${API}/api/admin/organizer-requests/${rid}/decision?approve=true`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  // organizer A's tournament is off-limits for organizer B
  const orgToken = await apiLogin(request, 'organizer@kwf.org', 'organizer123');
  const t = await (await request.post(`${API}/api/tournaments`, {
    headers: { Authorization: `Bearer ${orgToken}` },
    data: { name: 'PW Foreign Cup', start_date: '2026-12-01' },
  })).json();
  const r = await request.post(`${API}/api/tournaments/${t.id}/categories`, {
    headers: { Authorization: `Bearer ${coachToken}` },
    data: { name: 'Foreign Cat', gender: 'male' },
  });
  expect(r.status()).toBe(403);
});
