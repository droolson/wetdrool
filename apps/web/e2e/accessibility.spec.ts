import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ACCESSIBILITY_ROUTES = [
  '/',
  '/home',
  '/feeds',
  '/feed/following',
  '/feed/chronological',
  '/feed/trending',
  '/feed/media',
  '/about',
  '/protocol',
  '/safety',
  '/onboarding',
  '/signin',
  '/recovery',
  '/explore',
  '/search',
  '/stories',
  '/video',
  '/events',
  '/communities',
  '/community/example-community',
  '/community/example-community/admin',
  '/community/example-community/governance',
  '/profile/example-identity',
  '/profile/example-identity/edit',
  '/creator/example-identity',
  '/creator/example-identity/monetization',
  '/notifications',
  '/messages',
  '/messages/group',
  '/settings',
  '/settings/privacy',
  '/settings/safety',
  '/settings/blocks',
  '/settings/reports',
  '/settings/devices',
  '/settings/delegations',
  '/settings/wallet',
  '/settings/storage',
  '/settings/providers',
  '/settings/export',
  '/settings/migration',
  '/settings/delete',
  '/developers',
  '/status',
  '/compose',
] as const;

for (const route of ACCESSIBILITY_ROUTES) {
  test(`${route} has no detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route);
    const primaryHeading = page.locator('main h1');
    await expect(primaryHeading).toHaveCount(1);
    await expect(primaryHeading).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test('essential theme controls have accessible state', async ({ page }) => {
  await page.goto('/');

  let controls = page.getByRole('group', { name: 'Color theme' }).first();
  if (!(await controls.isVisible())) {
    await page.getByLabel('Open navigation').click();
    controls = page.getByRole('group', { name: 'Color theme' }).first();
  }
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button', { name: 'System' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
