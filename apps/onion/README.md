# `@wetdrool/onion` — Tor-optimized, JavaScript-free gateway

## Goals

- **No JavaScript** (CSP `script-src 'none'`) — works with Tor Browser Safest
- **No third-party** fonts, analytics, CDNs
- **Sealed rooms** — AES-256-GCM with room passphrase; ciphertext at rest
- **Img / GIF / video** share via multipart form (quality bytes stored sealed)
- **Forward path** from wetdrool.com clearnet product to this gateway

## Honest crypto boundary

Without browser JS, the server **must** decrypt briefly to render HTML.
Passphrase is **not stored**. For **client-only** E2EE use clearnet
`https://wetdrool.com/rooms/:id` (JS seal).

## Local

```bash
cd apps/onion
node scripts/dev-server.mjs
# http://127.0.0.1:3080
```

## Vercel

Deploy with root `apps/onion` (static `public/` + `api/`).

```bash
cd apps/onion
npx vercel@48 deploy --prod --yes
```

## Tor

1. Run gateway on `127.0.0.1:3080`
2. Copy `torrc.example` → Tor `HiddenService*`
3. Publish `hostname` `.onion`

## Cloudflare

Prefer **not** orange-cloud proxying a `.onion` (onion is separate).  
Clearnet `wetdrool.com` can link to the `.onion` URL once known.
