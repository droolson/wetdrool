# wetdrool-rooms (Cloudflare Worker)

Edge **ciphertext-only** store for E2EE rooms (same envelope as Vercel `/api/v1/rooms`).

```bash
cd workers/wetdrool-rooms
npm i
npx wrangler kv namespace create WETDROOL_ROOMS
# paste id into wrangler.toml [[kv_namespaces]]
npx wrangler deploy
```

Client seals with middle-out-lite + AES-GCM locally, then POSTs to:

`https://<worker>/v1/rooms/:roomId/messages`

Pair with wetdrool.com UI at `/rooms/:roomId` (Vercel Next app).
