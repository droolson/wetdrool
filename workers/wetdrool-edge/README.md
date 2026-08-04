# wetdrool-edge (Cloudflare Worker)

HTTP edge for **wetdrool.com** in front of the **Vercel** origin.

```text
Client → Cloudflare (zone + this Worker) → Vercel ORIGIN_URL
                                              (wallet-alpha or apps/web)
```

| Layer | Role |
| ----- | ---- |
| Cloudflare zone | DNS, TLS, CDN, WAF, bot fight |
| **This Worker** | Host allow-list, security headers, reverse proxy |
| Vercel | Static wallet-alpha / Next.js app |
| `@wetdrool/mesh` | Anytype/any-sync P2P foundation (not on this Worker) |

## Deploy

```bash
cd workers/wetdrool-edge
npm install
npx wrangler login
# optional: override origin
npx wrangler secret put ORIGIN_URL   # paste https://wallet-alpha-dun.vercel.app
npx wrangler deploy
```

### Attach to wetdrool.com

1. Cloudflare dashboard → **Workers & Pages** → `wetdrool-edge` → **Settings** → **Domains & Routes**
2. Add routes:
   - `wetdrool.com/*`
   - `www.wetdrool.com/*`
3. Or uncomment `routes` in `wrangler.toml` and redeploy (zone must be Full setup).

### DNS (Full setup)

| Type | Name | Content | Proxy |
| ---- | ---- | ------- | ----- |
| CNAME | `@` | `cname.vercel-dns.com` **or** leave A/AAAA to Worker route | Proxied (orange) |
| CNAME | `www` | same / apex | Proxied |

When the Worker owns `/*` routes, traffic hits the Worker first; the Worker fetches `ORIGIN_URL`.

Alternatively skip Worker routes and orange-cloud CNAME straight to Vercel — Worker is optional hardening.

## Health

`GET /.well-known/wetdrool-edge.json` → JSON status (`originConfigured`, `mesh: not_on_edge`).

## What this is not

- Not any-sync / Anytype peer mesh
- Not indexer / Postgres / media pipeline
- Not age verification or ID collection
