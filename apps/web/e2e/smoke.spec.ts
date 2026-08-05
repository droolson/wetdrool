import { expect, test } from '@playwright/test';

const COMMUNITY_ADDRESS = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';

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
  '/sites',
  '/launchpad',
  '/ai',
  '/market',
  '/rooms',
  '/fame',
  '/creators',
  '/live',
  '/mesh',
  '/token',
  '/hub',
  '/search',
  '/stories',
  '/video',
  '/events',
  '/communities',
  '/community/example-community',
  `/community/${COMMUNITY_ADDRESS}/admin`,
  `/community/${COMMUNITY_ADDRESS}/governance`,
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
  await expect(page.getByLabel('Search public posts, people, or communities')).toHaveValue('');

  await page.goto('/search?q=portable');
  await expect(page.getByRole('heading', { name: 'Connect an indexer to search.' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Sponsored result');
  await expect(page.locator('.post-card')).toHaveCount(0);
});

test('community discovery rejects unsafe URL state and never treats slugs as addresses', async ({
  page,
}) => {
  await page.goto('/communities?before=not%2Bopaque');
  await expect(
    page.getByRole('heading', { name: 'That community page reference is not valid.' }),
  ).toBeVisible();
  await expect(page.getByText('No request was sent to the configured indexer')).toBeVisible();
  await expect(page.locator('.community-card')).toHaveCount(0);

  await page.goto('/community/portable-commons');
  await expect(
    page.getByRole('heading', { name: 'That is not a canonical Solana community address.' }),
  ).toBeVisible();
  await expect(page.getByText('Slugs and display names are not accepted')).toBeVisible();
  await expect(page.locator('.community-proof')).toHaveCount(0);

  await page.goto(`/community/${COMMUNITY_ADDRESS}`);
  await expect(
    page.getByRole('heading', { name: 'Connect an indexer and DroolNet network scope.' }),
  ).toBeVisible();
  await expect(page.locator('.community-proof')).toHaveCount(0);

  for (const section of ['admin', 'governance'] as const) {
    await page.goto(`/community/portable-commons/${section}`);
    await expect(
      page.getByRole('heading', { name: 'That is not a canonical Solana community address.' }),
    ).toBeVisible();
    await expect(page.getByText('No provider request was sent')).toBeVisible();
    await expect(page.getByText('Never interpret a slug or display name')).toBeVisible();
  }
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
  await expect(page.getByLabel('Public WetDrool identity ID')).toHaveValue('not-an-identity');
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

test('locked composer preserves a local plain-text draft without claiming publication', async ({
  page,
}) => {
  await page.goto('/compose');

  await expect(
    page.getByRole('heading', { name: 'The development proof runtime is unavailable.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Localnet publication requires an explicit development-only write opt-in.'),
  ).toBeVisible();

  const text = '<img src=x onerror=alert(1)> A plain-text thought.';
  await page.getByLabel('Post text').fill(text);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved on this device.')).toBeVisible();

  const preview = page.locator('.preview-post');
  await expect(preview).toContainText(text);
  await expect(preview.locator('img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish unavailable' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Create a passkey account' })).toHaveAttribute(
    'href',
    '/onboarding',
  );
  await expect(page.getByRole('link', { name: 'Sign in with a passkey' })).toHaveAttribute(
    'href',
    '/signin',
  );
  await expect(page.locator('.publication-evidence')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Published globally');

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

  expect(download.suggestedFilename()).toBe('wetdrool-device-export.json');
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
