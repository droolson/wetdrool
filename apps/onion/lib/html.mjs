/** Minimal HTML escaping for no-JS SSR. */

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function layout({ title, body, flash }) {
  const flashHtml = flash
    ? `<p class="flash" role="status">${esc(flash)}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(title)} · WetDrool Onion</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">wetdrool</a>
  <span class="pill">onion · no javascript</span>
</header>
<main>
${flashHtml}
${body}
</main>
<footer class="foot">
  <p>18+ only. CSAM banned. Passphrase-sealed rooms — server decrypts only while rendering this page; passphrase is not stored.</p>
  <p><a href="https://wetdrool.com/">wetdrool.com</a> clearnet app · this gateway is Tor-optimized, script-free.</p>
</footer>
</body>
</html>`;
}
