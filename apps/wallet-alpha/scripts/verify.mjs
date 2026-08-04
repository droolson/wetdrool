import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "index.html",
  "styles.css",
  "profile.css",
  "config.js",
  "app.js",
  "protocol.js",
  "vault.js",
  "service-worker.js",
  "site.webmanifest",
  "vercel.json",
  ".well-known/wokenet-alpha.json",
  "assets/wetdrool-mark.svg",
  "assets/wetdrool-wordmark.png",
  "assets/kingofqueens6ix-pfp.jpg",
  "kingofqueens6ix/index.html",
];

for (const relativePath of requiredFiles) {
  await readFile(resolve(root, relativePath));
}

const html = await readFile(resolve(root, "index.html"), "utf8");
const vercel = JSON.parse(await readFile(resolve(root, "vercel.json"), "utf8"));
const status = JSON.parse(
  await readFile(resolve(root, ".well-known/wokenet-alpha.json"), "utf8"),
);
const config = await readFile(resolve(root, "config.js"), "utf8");
const logo = await readFile(resolve(root, "assets/wetdrool-wordmark.png"));
const logoHash = createHash("sha256").update(logo).digest("hex");
const pfp = await readFile(resolve(root, "assets/kingofqueens6ix-pfp.jpg"));
const pfpHash = createHash("sha256").update(pfp).digest("hex");

if (/<(script|link|img)[^>]+(?:src|href)=["']https?:/i.test(html)) {
  throw new Error("The alpha shell must not load third-party scripts, styles, or images.");
}
if (!html.includes("No transaction")) {
  throw new Error("The wallet request boundary must remain visible.");
}
if (!html.includes("It does not prove age")) {
  throw new Error("The wallet/age boundary must remain visible.");
}
if (status.publicNetwork !== false || status.onchainWrites !== false) {
  throw new Error("The alpha must not claim a deployed public network or onchain writes.");
}
if (status.adultContent !== false || status.publicUploads !== false) {
  throw new Error("Adult content and public uploads must remain disabled in the alpha.");
}
if (status.tokenRail?.mint !== null || status.tokenRail?.entryGate !== false) {
  throw new Error("The unverified token rail must remain mint-pending and non-gating.");
}
if (!config.includes('WET_CA: ""')) {
  throw new Error("Do not invent the $WET mint.");
}
if (logoHash !== "189edfc19f0dc276dfff2a34d7da4597ee9f45c93144431dfb9fc8b74223fead") {
  throw new Error("The approved WetDrool wordmark changed unexpectedly.");
}
if (pfpHash !== "bf473aea87ecfdd21bf6a745fed84c1a8b90097f2b446248b9522a555fba3f85") {
  throw new Error("The approved @kingofqueens6ix profile image changed unexpectedly.");
}

const csp = vercel.headers
  ?.flatMap((entry) => entry.headers || [])
  .find((header) => header.key === "Content-Security-Policy")?.value;
if (!csp || csp.includes("'unsafe-inline'") || !csp.includes("connect-src 'none'")) {
  throw new Error("The alpha CSP must remain self-only and network-silent.");
}

console.log("WetDrool wallet alpha static verification passed.");
