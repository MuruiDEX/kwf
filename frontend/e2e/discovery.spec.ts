/** Wave A2 discovery: /search, tournament filters URL state, CommandMenu
 *  regression, mobile layout, dark-mode persistence.
 *  Uses ONLY seeded data (KWF Championship 2026 / Kyokushin Almaty) + public API.
 */
import { expect, test } from '@playwright/test';

test('/search hint for short query, results for seeded data', async ({ page }) => {
  await page.goto('/search');
  await expect(page.getByTestId('search-page')).toBeVisible();
  await expect(page.getByText('Что ищете?')).toBeVisible();

  // q < 2 => no request, hint stays
  await page.getByTestId('search-input').fill('K');
  await expect(page.getByText('Что ищете?')).toBeVisible();

  // seeded tournament is found via the shared /api/search contract
  await page.getByTestId('search-input').fill('KWF');
  await expect(page.getByTestId('search-tournaments')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('search-tournament-hit').first()).toContainText('KWF');
});

test('/search scope toggles filter sections', async ({ page }) => {
  await page.goto('/search?q=KWF');
  await expect(page.getByTestId('search-tournaments')).toBeVisible({ timeout: 15000 });
  // disable tournaments scope => section disappears
  await page.getByTestId('search-scope-tournaments').click();
  await expect(page.getByTestId('search-tournaments')).toHaveCount(0);
  // re-enable => back
  await page.getByTestId('search-scope-tournaments').click();
  await expect(page.getByTestId('search-tournaments')).toBeVisible({ timeout: 15000 });
});

test('/tournaments filters persist across refresh and shared URLs', async ({ page }) => {
  await page.goto('/tournaments?city=Almaty');
  await expect(page.getByTestId('filter-bar')).toBeVisible();
  await expect(page.getByTestId('filter-city')).toHaveValue('Almaty');
  // seeded Almaty tournament renders as a discovery card
  await expect(page.getByTestId('discovery-card').first()).toBeVisible({ timeout: 15000 });

  // refresh preserves filters
  await page.reload();
  await expect(page.getByTestId('filter-city')).toHaveValue('Almaty');
  await expect(page.getByTestId('discovery-card').first()).toBeVisible({ timeout: 15000 });

  // copied URL reproduces the same filters (legacy ?q&?status compat)
  const url = page.url();
  expect(url).toContain('city=Almaty');
  await page.goto(url);
  await expect(page.getByTestId('filter-city')).toHaveValue('Almaty');

  // reset clears the URL
  await page.getByTestId('filter-reset').click();
  await expect(page).toHaveURL(/\/tournaments(\?)?$/);
});

test('/tournaments status filter updates URL', async ({ page }) => {
  await page.goto('/tournaments');
  await page.getByTestId('filter-status').selectOption('upcoming');
  await expect(page).toHaveURL(/status=upcoming/);
  await page.reload();
  await expect(page.getByTestId('filter-status')).toHaveValue('upcoming');
});

test('CommandMenu still works and shows tournament hits', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command menu' })).toBeVisible();
  await page.getByPlaceholder('Команда или поиск спортсмена…').fill('KWF');
  await expect(page.getByRole('dialog').getByText('KWF Championship 2026').first()).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command menu' })).toHaveCount(0);
});

test('discovery has no page overflow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/tournaments?city=Almaty', '/search?q=KWF', '/']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test('/search URL stays source of truth (in-app nav, back)', async ({ page }) => {
  await page.goto('/search?q=KWF');
  await expect(page.getByTestId('search-input')).toHaveValue('KWF');
  await expect(page.getByTestId('search-tournaments')).toBeVisible({ timeout: 15000 });

  // F-UX-1: same-mounted navigation (CommandMenu "Все результаты" pushes
  // /search?q=... without remount) must flow into the input.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command menu' })).toBeVisible();
  await page.getByPlaceholder('Команда или поиск спортсмена…').fill('Almaty');
  const allResults = page.getByRole('dialog').getByText(/Все результаты/);
  await expect(allResults).toBeVisible({ timeout: 15000 });
  await allResults.click();
  await expect(page).toHaveURL(/q=Almaty/);
  await expect(page.getByTestId('search-input')).toHaveValue('Almaty');

  // real browser Back restores the previous URL, input and results
  await page.goBack();
  await expect(page).toHaveURL(/q=KWF/);
  await expect(page.getByTestId('search-input')).toHaveValue('KWF');
  await expect(page.getByTestId('search-tournaments')).toBeVisible({ timeout: 15000 });

  // Back to a bare /search restores the empty state
  await page.goto('/search');
  await expect(page.getByTestId('search-input')).toHaveValue('');
  await page.goto('/search?q=KWF');
  await expect(page.getByTestId('search-input')).toHaveValue('KWF');
  await page.goBack();
  await expect(page.getByTestId('search-input')).toHaveValue('');
  await expect(page.getByText('Что ищете?')).toBeVisible();
});

test('/tournaments rapid status+q change preserves both (F-UX-2)', async ({ page }) => {
  await page.goto('/tournaments');
  await expect(page.getByTestId('filter-bar')).toBeVisible();
  // change status, then type q immediately (inside the 300ms debounce
  // window): the debounced commit must merge into CURRENT filters.
  await page.getByTestId('filter-status').selectOption('upcoming');
  await page.getByTestId('filter-q').fill('cup');
  await expect(page).toHaveURL(/status=upcoming/, { timeout: 10000 });
  await expect(page).toHaveURL(/q=cup/, { timeout: 10000 });
  await expect(page.getByTestId('filter-status')).toHaveValue('upcoming');
  await expect(page.getByTestId('filter-q')).toHaveValue('cup');
});

test('dark mode persists across reload', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Переключить тему' }).first();
  // force light first for determinism
  await page.evaluate(() => {
    localStorage.setItem('kwf-theme', 'light');
    document.documentElement.classList.remove('dark');
  });
  await toggle.click();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('kwf-theme'))).toBe('dark');
  await page.reload();
  await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
});
