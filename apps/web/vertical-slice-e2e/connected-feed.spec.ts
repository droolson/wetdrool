import { expect, test } from '@playwright/test';

const expectedAuthor = required('VERTICAL_SLICE_EXPECTED_AUTHOR');
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
  await expect(page.getByText('Woke Network open indexer', { exact: true })).toBeVisible();
  await expect(page.getByText(/No live feed substituted/u)).toHaveCount(0);

  await page.getByText('Verification details', { exact: true }).click();
  await expect(page.getByText(/finalized/u)).toBeVisible();
  await expect(page.getByText('Valid', { exact: true })).toHaveCount(2);

  const detailResponse = await page.goto(`/post/${encodeURIComponent(expectedPostId)}`);
  expect(detailResponse?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'A verified protocol object' })).toBeVisible();
  await expect(page.getByText(expectedAuthor, { exact: true })).toBeVisible();
  await expect(page.getByText(expectedPost, { exact: true })).toBeVisible();
  await expect(page.getByText(suppressedPost, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Indexer: verified', { exact: true })).toBeVisible();
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required; this suite never substitutes fake feed data.`);
  }
  return value;
}
