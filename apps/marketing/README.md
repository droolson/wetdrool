# @wokesocial/marketing

Public marketing launch site for **WokeSocial**, built from the
`Woke.social Marketing Launch` design-canvas package (landing + docs, design
system tokens/components, brand assets, and the points/handle demo logic).

This app is a **static site**. It does not talk to the indexer, auth service, or
Solana program. Interactive bits (countdown, handle checker, points HUD, docs
browser) run entirely in the browser.

## Local development

```sh
pnpm --filter @wokesocial/marketing dev
# open http://127.0.0.1:3100
```

```sh
pnpm --filter @wokesocial/marketing build   # verifies required static assets
```

## Deploy (Vercel)

The production project is deployed with the Infisical-managed
`vercel_api_token` (Hermes Agent Secrets / prod):

```sh
# pull token without printing it
export VERCEL_TOKEN="$(
  infisical secrets get vercel_api_token --plain \
    --domain http://localhost:8088/api \
    --projectId 8235188f-756f-4ad9-91f3-04aa593c9695 \
    --env=prod
)"

cd apps/marketing
npx --yes vercel@48.1.6 deploy --prod --yes \
  --token "$VERCEL_TOKEN" \
  --scope mythicagent
```

Or from the monorepo root with an explicit project link under
`apps/marketing/.vercel/`.

## Routes

| Path | File |
| ---- | ---- |
| `/` | `index.html` (landing) |
| `/docs` | `docs.html` (docs browser) |

Design-canvas filenames (`Landing.dc.html`, `Docs.dc.html`) rewrite to the
clean URLs above.

## Source materials

Copied and production-polished from:

`/Users/raphaelcardona/Downloads/Woke.social Marketing Launch`

- `Landing.dc.html` / interactive launch page
- `Docs.dc.html` + `docs-data.js` documentation browser
- `_ds/wokesocial-design-system-*` tokens and component bundle
- `assets/logo/*` brand artwork
- `support.js` design-canvas runtime (loads React from unpkg at runtime)
