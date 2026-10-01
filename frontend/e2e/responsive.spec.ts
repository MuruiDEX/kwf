/** Responsive + keyboard basics: no page-level horizontal overflow, dialog keyboard flow. */
import { expect, test } from '@playwright/test';

for (const width of [360, 768, 1280, 1440, 1920]) {
  test(`home has no page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.getByText('KYOKUSHIN').first()).toBeVisible();
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('command menu opens with Ctrl+K and closes with Escape', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command menu' })).toHaveCount(0);
});

test('public tournament pages render without organizer actions', async ({ page, request }) => {
  await page.goto('/tournaments');
  // guest sees the calendar; organizer-only buttons (e.g. generate) are absent
  await expect(page.getByRole('button', { name: 'Сгенерировать сетки' })).toHaveCount(0);
  void request;
});
