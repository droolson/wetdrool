import { expect, test } from '@playwright/test';
import { OPEN_INDEXER_FEED_RECIPE } from '@wokesocial/indexer-client';

const expectedAuthor = required('VERTICAL_SLICE_EXPECTED_AUTHOR');
const expectedCommunity = required('VERTICAL_SLICE_EXPECTED_COMMUNITY');
const expectedCommunityAddress = required('VERTICAL_SLICE_EXPECTED_COMMUNITY_ADDRESS');
const expectedCommunitySlug = required('VERTICAL_SLICE_EXPECTED_COMMUNITY_SLUG');
const expectedPost = required('VERTICAL_SLICE_EXPECTED_POST');
const expectedPostId = required('VERTICAL_SLICE_EXPECTED_POST_ID');
const suppressedPost = required('VERTICAL_SLICE_SUPPRESSED_POST');

test('renders the finalized validator post through the production indexer', async ({ page }) => {
  const response = await page.goto('/home');
  expect(response?.ok()).toBe(true);

  await expect(
    page.getByRole('heading', { name: 'Latest from the configured indexer' }),
  ).toBeVisible();
  await expect(page.getByText(expectedAuthor, { exact: true })).toBeVisible();
  await expect(page.getByText(expectedPost, { exact: true })).toBeVisible();
  await expect(page.getByText(suppressedPost, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Indexer: verified', { exact: true })).toBeVisible();
  await expect(page.getByText('WokeNet open indexer', { exact: true })).toBeVisible();
  await expect(page.getByText(/No live feed substituted/u)).toHaveCount(0);

  await page.getByText('Verification details', { exact: true }).click();
  await expect(page.getByText(/finalized/u)).toBeVisible();
  await expect(page.getByText('Valid', { exact: true })).toHaveCount(2);

  const chronologicalResponse = await page.goto('/feed/chronological');
  expect(chronologicalResponse?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Latest in strict time order' })).toBeVisible();
  await expect(page.getByText(expectedAuthor, { exact: true })).toBeVisible();
  await expect(page.getByText(expectedPost, { exact: true })).toBeVisible();
  await expect(page.getByText(suppressedPost, { exact: true })).toHaveCount(0);
  await expect(page.getByText(OPEN_INDEXER_FEED_RECIPE, { exact: true })).toBeVisible();

  const detailResponse = await page.goto(`/post/${encodeURIComponent(expectedPostId)}`);
  expect(detailResponse?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'A verified protocol object' })).toBeVisible();
  await expect(page.getByText(expectedAuthor, { exact: true })).toBeVisible();
  await expect(page.getByText(expectedPost, { exact: true })).toBeVisible();
  await expect(page.getByText(suppressedPost, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Indexer: verified', { exact: true })).toBeVisible();
});

test('discovers the finalized validator community through verified public projections', async ({
  page,
}) => {
  const directoryResponse = await page.goto('/communities');
  expect(directoryResponse?.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'Find a space with rules you can verify.' }),
  ).toBeVisible();
  await expect(page.getByText(expectedCommunity, { exact: true })).toBeVisible();
  await expect(page.getByText(`c/${expectedCommunitySlug}`, { exact: true })).toBeVisible();
  await expect(page.getByText('Verified manifest', { exact: true })).toBeVisible();

  const detailResponse = await page.goto(
    `/community/${encodeURIComponent(expectedCommunityAddress)}`,
  );
  expect(detailResponse?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: expectedCommunity, level: 1 })).toBeVisible();
  await expect(page.getByText('Verified public manifest', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'One active member, one vote.' })).toBeVisible();
  await expect(page.getByText('No roster exposed', { exact: true })).toBeVisible();

  await page.getByText('Verification and Solana anchor details', { exact: true }).click();
  await expect(page.getByText(expectedCommunityAddress, { exact: true })).toBeVisible();

  const searchResponse = await page.goto(`/search?q=${encodeURIComponent(expectedCommunity)}`);
  expect(searchResponse?.ok()).toBe(true);
  await expect(page.getByText(expectedCommunity, { exact: true })).toBeVisible();
  await expect(page.getByText('public-match-v2', { exact: true })).toBeVisible();
  await expect(page.getByText('Community name', { exact: true })).toBeVisible();
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required; this suite never substitutes fake feed data.`);
  }
  return value;
}
