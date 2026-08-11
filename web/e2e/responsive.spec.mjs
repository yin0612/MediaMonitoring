import { test, expect } from '@playwright/test';

const routes = ['/', '/search', '/recent', '/analysis', '/overview', '/keywords', '/topics', '/entities', '/method'];
const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1024, height: 900 },
  { name: 'wide', width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test.describe(`${viewport.name} ${viewport.width}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of routes) {
      test(`${route} renders without horizontal overflow`, async ({ page }) => {
        await page.goto(`/#${route === '/' ? '/' : route}`, { waitUntil: 'networkidle' });
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('h1')).toHaveCount(1);

        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(dimensions.scrollWidth, `${route} overflows at ${viewport.width}px`).toBeLessThanOrEqual(
          dimensions.clientWidth + 1,
        );

        if (viewport.width <= 1100) {
          const moreButton = page.locator('.mobile-tabbar button').first();
          await expect(moreButton).toBeVisible();
          await moreButton.click();
          await expect(page.locator('.mobile-sheet[role="dialog"]')).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.locator('.mobile-sheet[role="dialog"]')).toHaveCount(0);
        } else {
          await expect(page.locator('.mobile-tabbar')).toBeHidden();
          await expect(page.locator('.topnav')).toBeVisible();
        }
      });
    }

    test(`home screenshot ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.goto('/#/', { waitUntil: 'networkidle' });
      await expect(page.locator('main')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}.png`), fullPage: true });
    });
  });
}
