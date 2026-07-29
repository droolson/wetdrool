import { expect, test } from '@playwright/test';

const ROUTES = [
  '/',
  '/home',
  '/home?feed=following',
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
  '/post/foundation-check',
] as const;

for (const route of ROUTES) {
  test(`${route} renders an honest semantic page`, async ({ page }) => {
    const response = await page.goto(route);

    expect(response?.ok()).toBe(true);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Transaction successful');
  });
}

test('skip link reaches the main landmark', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await skipLink.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('theme picker exposes high contrast without hiding content', async ({ page }) => {
  await page.goto('/');

  let contrast = page.getByRole('button', { name: 'Contrast' }).first();
  if (!(await contrast.isVisible())) {
    await page.getByLabel('Open navigation').click();
    contrast = page.getByRole('button', { name: 'Contrast' }).first();
  }
  await contrast.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
  await expect(page.locator('h1')).toBeVisible();
});

test('public search validates locally and degrades without fabricating results', async ({
  page,
}) => {
  await page.goto('/search?q=xy');
  await expect(
    page.getByRole('heading', { name: 'Use at least 3 normalized Unicode code points.' }),
  ).toBeVisible();
  await expect(page.getByText('was rejected in full and was not truncated')).toBeVisible();

  await page.goto(`/search?q=${'x'.repeat(121)}`);
  await expect(
    page.getByRole('heading', { name: 'Use no more than 120 normalized Unicode code points.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Search public posts or people')).toHaveValue('');

  await page.goto('/search?q=portable');
  await expect(page.getByRole('heading', { name: 'Connect an indexer to search.' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Sponsored result');
  await expect(page.locator('.post-card')).toHaveCount(0);
});

test('projected feed routes reject unsafe scope before contacting a provider', async ({ page }) => {
  await page.goto('/feed/chronological?before=not%2Bopaque');
  await expect(
    page.getByRole('heading', { name: 'That feed page reference is not valid.' }),
  ).toBeVisible();
  await expect(page.getByText('No request was sent to the configured indexer.')).toBeVisible();
  await expect(page.locator('.post-card')).toHaveCount(0);

  await page.goto('/feed/following?viewer=not-an-identity');
  await expect(
    page.getByRole('heading', { name: 'That public identity is not canonical.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Public WokeSocial identity ID')).toHaveValue('not-an-identity');
  await expect(page.locator('.post-card')).toHaveCount(0);
});

test('mobile navigation opens with keyboard-accessible links', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/');

  await page.getByLabel('Open navigation').click();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('link', { name: 'Safety' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('link', { name: 'Feeds' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Mobile app navigation' })
      .getByRole('link', { name: 'Compose' }),
  ).toBeVisible();
});

test('local composer restores a plain-text draft without enabling publication', async ({
  page,
}) => {
  await page.goto('/compose');

  const text = '<img src=x onerror=alert(1)> A plain-text thought.';
  await page.getByLabel('Post text').fill(text);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved on this device.')).toBeVisible();

  const preview = page.locator('.preview-post');
  await expect(preview).toContainText(text);
  await expect(preview.locator('img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish unavailable' })).toBeDisabled();

  await page.reload();
  await expect(page.getByLabel('Post text')).toHaveValue(text);
  await expect(page.getByText('A draft saved on this device was restored.')).toBeVisible();

  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('button', { name: 'Discard now' }).click();
  await expect(page.getByLabel('Post text')).toHaveValue('');
});

test('device-local privacy settings restore without claiming account persistence', async ({
  page,
}) => {
  await page.goto('/settings/privacy');

  const presence = page.getByRole('checkbox', { name: /Hide my presence by default/u });
  await expect(presence).toBeChecked();
  await presence.uncheck();
  await page.getByRole('button', { name: 'Save on this device' }).click();
  await expect(page.getByText('These preferences were saved in this browser.')).toBeVisible();

  await page.reload();
  await expect(presence).not.toBeChecked();
  await expect(page.locator('body')).not.toContainText('Saved to your account');
});

test('local safety list persists and removes an exact identifier', async ({ page }) => {
  await page.goto('/settings/blocks');

  await page.getByLabel('Public identity identifier').fill('identity-local-test');
  await page.getByRole('button', { name: 'Add local boundary' }).click();
  await expect(page.getByRole('code')).toHaveText('identity-local-test');

  await page.reload();
  await expect(page.getByRole('code')).toHaveText('identity-local-test');
  await page.getByRole('button', { name: 'Remove identity-local-test' }).click();
  await expect(page.getByRole('code')).toHaveCount(0);
});

test('local export downloads only the scoped device JSON', async ({ page }) => {
  await page.goto('/settings/export');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download local device export' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('wokesocial-device-export.json');
  await expect(page.getByText(/No identity, post history, relationships/u)).toBeVisible();
});

test('report, appeal, and deletion mutations remain disabled', async ({ page }) => {
  await page.goto('/settings/reports');
  await expect(
    page.getByRole('button', { name: 'Encrypted submission unavailable' }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start appeal unavailable' })).toBeDisabled();

  await page.goto('/settings/delete');
  await expect(page.getByRole('button', { name: 'Delete unavailable' })).toBeDisabled();
  await expect(
    page.getByText(/changes no browser, service, storage, or protocol data/u),
  ).toBeVisible();
});
