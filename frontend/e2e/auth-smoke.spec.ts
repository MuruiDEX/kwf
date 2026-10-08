/** Browser smoke test for the auth flows (no refactoring target).
 *  Register -> auto-login -> Cabinet -> refresh -> logout -> login -> from-redirect,
 *  wrong password, duplicate email, mobile overflow, console/network hygiene.
 */
import { expect, test, type Page } from '@playwright/test';

const uid = `smoke${Date.now() % 100000}`;

// Infra pacing (NOT a state wait): athlete-profile's auth burst shares our
// per-IP sliding window (10 login POSTs/60s). Same convention as multirole.
test.beforeAll(async () => {
  await new Promise((r) => setTimeout(r, 65_000));
});

type Noise = { pageErrors: string[]; consoleErrors: string[]; badResponses: string[]; failedReqs: string[] };

async function watch(page: Page): Promise<{ noise: Noise; loginCalls: string[] }> {
  const noise: Noise = { pageErrors: [], consoleErrors: [], badResponses: [], failedReqs: [] };
  const loginCalls: string[] = [];
  page.on('pageerror', (e) => noise.pageErrors.push(String(e)));
  // Browsers log failed HTTP responses as console errors even when the app
  // handles them (guest /me 401, duplicate 400, bad login 401...). Only
  // unexpected console noise fails the suite.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource.*status of (40[0149]|40[13]|422|429)/.test(t)) return;
    noise.consoleErrors.push(t.slice(0, 200));
  });
  page.on('request', (r) => { if (r.url().includes('/api/auth/login')) loginCalls.push(r.url()); });
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/auth/me') && r.status() === 401) return; // expected for guests
    if (r.status() >= 500) noise.badResponses.push(`${r.status()} ${u}`);
  });
  page.on('requestfailed', (r) => {
    if (r.url().endsWith('/favicon.ico')) return;
    noise.failedReqs.push(`${r.failure()?.errorText} ${r.url()}`);
  });
  return { noise, loginCalls };
}

function expectClean(n: Noise) {
  expect(n.pageErrors, `pageErrors: ${n.pageErrors.join(' | ')}`).toEqual([]);
  expect(n.consoleErrors, `console: ${n.consoleErrors.join(' | ')}`).toEqual([]);
  expect(n.badResponses, `5xx: ${n.badResponses.join(' | ')}`).toEqual([]);
  expect(n.failedReqs, `failed: ${n.failedReqs.join(' | ')}`).toEqual([]);
}

async function registerUI(page: Page, email: string, name = 'Smoke User') {
  await page.goto('/me');
  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.getByPlaceholder('Имя').fill(name);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill('secret123');
  await page.locator('form').getByRole('button', { name: 'Создать аккаунт' }).click();
  // wait for auto-login + /me dispatch before navigating away (else the
  // register POST can be aborted by the next goto and the session is lost)
  await expect(page).toHaveURL(/\/(athlete|coach|referee)(\?|$)/);
}

// Role UX 3.0: /me dispatches to the role home (athlete by default here).
async function expectAthleteHome(page: Page, email: string) {
  await expect(page).toHaveURL(/\/athlete(\?|$)/);
  await expect(page.locator('main').getByText('Мои турниры').first()).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
}

async function uiLogout(page: Page) {
  // Logout lives in the header account menu (role homes have no inline logout).
  await page.goto('/me');
  await page.locator('header').getByRole('button', { name: 'Профиль' }).click();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
}

test('register -> auto-login -> cabinet (no second login call, cookie set)', async ({ page, context }) => {
  const { noise, loginCalls } = await watch(page);
  const email = `${uid}a@kwf.org`;
  await registerUI(page, email);
  // Role home visible without touching the Login tab
  await expectAthleteHome(page, email);
  // no second /login request happened
  expect(loginCalls).toEqual([]);
  // HttpOnly cookie present
  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name === 'kwf_token' && c.httpOnly)).toBeTruthy();
  expectClean(noise);
});

test('refresh keeps session, logout drops it (incl. after F5)', async ({ page }) => {
  await watch(page);
  const email = `${uid}b@kwf.org`;
  await registerUI(page, email);
  await expectAthleteHome(page, email);
  await page.reload();
  await expectAthleteHome(page, email);
  await uiLogout(page);
  await page.reload();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByText('Мои турниры')).toHaveCount(0);
});

test('login -> cabinet -> refresh; protected page returns after login', async ({ page }) => {
  await watch(page);
  const email = `${uid}c@kwf.org`;
  await registerUI(page, email);
  await uiLogout(page);
  // guest hits protected page -> bounced to /me
  await page.goto('/organizer');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  // login -> athlete cannot open /organizer, lands on the role home (no loop)
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill('secret123');
  await page.locator('form').getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/athlete(\?|$)/);
  await page.reload();
  await expect(page).toHaveURL(/\/athlete(\?|$)/);
});

test('wrong password: clear error, form stays usable', async ({ page }) => {
  const { noise } = await watch(page);
  const email = `${uid}d@kwf.org`;
  await registerUI(page, email);
  await uiLogout(page);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill('wrong-pass');
  const btn = page.locator('form').getByRole('button', { name: 'Войти' });
  await btn.click();
  await expect(page.locator('.form-err')).toBeVisible();
  await expect(btn).toBeEnabled();
  // retry with correct password works
  await page.getByPlaceholder('Пароль').fill('secret123');
  await btn.click();
  await expect(page).toHaveURL(/\/athlete(\?|$)/);
  expectClean(noise);
});

test('duplicate registration: 400, app stays alive', async ({ page }) => {
  const { noise } = await watch(page);
  const email = `${uid}e@kwf.org`;
  await registerUI(page, email);
  await expect(page).toHaveURL(/\/athlete(\?|$)/);
  await uiLogout(page);
  await page.goto('/me');
  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.getByPlaceholder('Имя').fill('Dupe');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill('secret123');
  await page.locator('form').getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.locator('.form-err')).toContainText(/уже зарегистрирован|тiркелген|registered/i);
  // app alive: switch to login tab and log in
  await page.getByRole('button', { name: 'Войти', exact: true }).first().click();
  await expect(page.getByPlaceholder('Пароль')).toBeVisible();
  expectClean(noise);
});

test('mobile 390px: no horizontal overflow on key pages', async ({ page }) => {
  await watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const email = `${uid}m@kwf.org`;
  await registerUI(page, email);
  await expect(page).toHaveURL(/\/athlete(\?|$)/);
  for (const url of ['/me', '/tournaments', '/rankings', '/athletes', '/news']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${url}: ${overflow}px`).toBeLessThanOrEqual(1);
  }
});

// Infra pacing, NOT a state wait and NOT a test: the backend rate-limits auth
// endpoints (10/60s per IP) and this file alone performs ~6 registrations +
// ~4 logins. Without a gap, the next file's auth burst lands in the same
// sliding window and trips 429. Production limits, workers and auth logic
// are untouched; register/login tests still hit the real endpoints.
test.afterAll(async () => {
  await new Promise((r) => setTimeout(r, 65_000));
});
