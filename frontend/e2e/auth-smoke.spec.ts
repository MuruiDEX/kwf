/** Browser smoke test for the auth flows (no refactoring target).
 *  Register -> auto-login -> Cabinet -> refresh -> logout -> login -> from-redirect,
 *  wrong password, duplicate email, mobile overflow, console/network hygiene.
 */
import { expect, test, type Page } from '@playwright/test';

const uid = `smoke${Date.now() % 100000}`;

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
}

test('register -> auto-login -> cabinet (no second login call, cookie set)', async ({ page, context }) => {
  const { noise, loginCalls } = await watch(page);
  const email = `${uid}a@kwf.org`;
  await registerUI(page, email);
  // Cabinet visible without touching the Login tab
  await expect(page.getByText('Мои турниры')).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
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
  await expect(page.getByText('Мои турниры')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Мои турниры')).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByText('Мои турниры')).toHaveCount(0);
});

test('login -> cabinet -> refresh; protected page returns after login', async ({ page }) => {
  await watch(page);
  const email = `${uid}c@kwf.org`;
  await registerUI(page, email);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  // guest hits protected page -> bounced to /me
  await page.goto('/organizer');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  // login -> back to the original page (no loop; athlete sees role-hint there)
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill('secret123');
  await page.locator('form').getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/organizer$/);
  await page.reload();
  await expect(page).toHaveURL(/\/organizer$/);
});

test('wrong password: clear error, form stays usable', async ({ page }) => {
  const { noise } = await watch(page);
  const email = `${uid}d@kwf.org`;
  await registerUI(page, email);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Пароль').fill('wrong-pass');
  const btn = page.locator('form').getByRole('button', { name: 'Войти' });
  await btn.click();
  await expect(page.locator('.form-err')).toBeVisible();
  await expect(btn).toBeEnabled();
  // retry with correct password works
  await page.getByPlaceholder('Пароль').fill('secret123');
  await btn.click();
  await expect(page.getByText('Мои турниры')).toBeVisible();
  expectClean(noise);
});

test('duplicate registration: 400, app stays alive', async ({ page }) => {
  const { noise } = await watch(page);
  const email = `${uid}e@kwf.org`;
  await registerUI(page, email);
  await expect(page.getByText('Мои турниры')).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).click();
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
  await expect(page.getByText('Мои турниры')).toBeVisible();
  for (const url of ['/me', '/tournaments', '/rankings', '/athletes', '/news']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${url}: ${overflow}px`).toBeLessThanOrEqual(1);
  }
});
