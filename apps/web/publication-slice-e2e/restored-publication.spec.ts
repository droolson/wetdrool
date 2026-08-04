import { readFile, stat } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const EVIDENCE_PATH = required('PUBLICATION_SLICE_EVIDENCE_PATH');
const MAX_EVIDENCE_BYTES = 32 * 1_024;

test('renders both durable-ledger-restored posts through feed and detail routes', async ({
  page,
}) => {
  const info = await stat(EVIDENCE_PATH);
  expect(info.isFile()).toBe(true);
  expect(info.size).toBeGreaterThan(1);
  expect(info.size).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES);
  const evidence = JSON.parse(await readFile(EVIDENCE_PATH, 'utf8')) as {
    readonly schema: string;
    readonly posts: readonly {
      readonly body: string;
      readonly objectId: string;
      readonly transactionSignature: string;
    }[];
  };
  expect(evidence.schema).toBe('wetdrool.vertical-slice.publication-evidence.v2');
  expect(evidence.posts).toHaveLength(2);

  const feedResponse = await page.goto('/home');
  expect(feedResponse?.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'Latest from the configured indexer' }),
  ).toBeVisible();
  for (const post of evidence.posts) {
    await expect(page.getByText(post.body, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Indexer: verified', { exact: true })).toHaveCount(
    evidence.posts.length + 1,
  );

  for (const post of evidence.posts) {
    const detailResponse = await page.goto(`/post/${encodeURIComponent(post.objectId)}`);
    expect(detailResponse?.ok()).toBe(true);
    await expect(page.getByRole('heading', { name: 'A verified protocol object' })).toBeVisible();
    await expect(page.getByText(post.body, { exact: true })).toBeVisible();
    await expect(page.getByText('Indexer: verified', { exact: true })).toBeVisible();
    await page.getByText('Verification details', { exact: true }).click();
    await expect(page.getByText(post.transactionSignature, { exact: true })).toBeVisible();
  }
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for restored publication verification.`);
  return value;
}
