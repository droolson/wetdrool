import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html',
  'docs.html',
  'support.js',
  'docs-data.js',
  'vercel.json',
  'assets/logo/woke-mark.svg',
  'assets/logo/woke-banner.svg',
  'assets/logo/woke-lockup.svg',
  '_ds/wokesocial-design-system-273eab7b-b0fd-4b44-b4e3-2429d9bc73d2/_ds_bundle.js',
  '_ds/wokesocial-design-system-273eab7b-b0fd-4b44-b4e3-2429d9bc73d2/styles.css',
];

for (const relative of required) {
  await access(join(root, relative));
}

console.log(`@wokesocial/marketing: static bundle verified (${required.length} paths).`);
