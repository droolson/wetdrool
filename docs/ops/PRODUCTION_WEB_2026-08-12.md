# WetDrool production web receipt — 2026-08-12

## Decision

`wetdrool.com` now serves the standalone WetDrool social/creator web app from the dedicated
Vercel project `wetdrool-web`. The existing 18+ game remains independent at
`https://drooly.ai/games/wetdrool` and was not modified.

## Deployment

| Field | Verified value |
| --- | --- |
| Canonical origin | `https://wetdrool.com` |
| Vercel team | `mythicagent` / Mythic Agent |
| Project | `wetdrool-web` (`prj_XuGVbO9dFScPwXdJaclHcIzKPNkq`) |
| Production deployment | `dpl_HSVecWbfzACKUNJfE49ghurfHusV` |
| Build result | Next.js production build passed; 46 static pages generated |
| Custom domains | `wetdrool.com`, `www.wetdrool.com` |
| `www` behavior | Exact-host `308` to the path/query-preserving apex URL |

## Public verification

The following checks returned the expected public response after deployment:

- `GET https://wetdrool.com/` → `200` HTML;
- `GET https://wetdrool.com/api/v1/health` → `200` JSON;
- `GET https://wetdrool.com/api/v1/status` → `200` JSON;
- `GET https://wetdrool.com/onboarding` → `200` HTML;
- `GET https://wetdrool.com/market` → `200` HTML;
- `GET https://wetdrool.com/rooms` → `200` HTML;
- `GET https://www.wetdrool.com/test/path?x=1` → `308` to
  `https://wetdrool.com/test/path?x=1`;
- `GET https://drooly.ai/games/wetdrool` → `200` at the unchanged game URL.

Browser QA verified the 18+ local self-attestation gate, the post-gate launch surface, desktop and
390×844 responsive layouts, no horizontal mobile overflow, and no captured console errors.

## Honest capability boundary

The public product shell, discovery/API surfaces, passkey client flow, creator surfaces, portable
protocol implementation, private-room UI, moderation model, and fail-closed market are deployed.
This receipt does **not** claim that production accounts, uploads, livestream ingest, payouts,
subscriptions, creator earnings, a public DroolNet Solana deployment, or a WetDrool token are live.

At verification time `/api/v1/status` reported:

- `level: preview`;
- `revenueReady: false`;
- `network: solana:devnet`;
- `marketplaceStore: memory-ephemeral`;
- `roomsStore: memory-ephemeral`;
- `droolMint: does-not-exist`.

Commerce must remain fail-closed until a durable multi-replica store, reviewed recipient and
settlement policy, verified entitlements, production authentication, legal/adult-platform review,
and real receipt reconciliation are in place.

## Verification evidence

- focused Vitest: 60 passed across canonical host, room store, product API helpers, and revenue
  readiness;
- focused ESLint for changed launch/client files: passed;
- Prettier and `git diff --check`: passed;
- local Next.js production build: passed;
- Vercel production build: passed.

The repository-wide lint and unit suites still contain inherited failures outside this launch
slice; they are not represented as passing by this receipt.
