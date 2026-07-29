# WokeSocial for Solana Mobile

This Expo/React Native Android app is the WokeSocial client foundation for
Solana Seeker and other Mobile Wallet Adapter-compatible Android devices.
WokeNet is the WokeSocial program/deployment namespace on Solana; this app does
not connect to a separate WokeNet blockchain.

## Current slice

- Native Android development build with Mobile Wallet Adapter.
- Explicit wallet connect/disconnect. A connected wallet is a signer, not by
  itself a WokeSocial identity.
- Finalized verification of the configured Solana genesis and executable
  WokeSocial program account before protocol features can be enabled.
- Strict, shared open-indexer client for the verified chronological feed.
- Honest unconfigured, unavailable, invalid-response, empty, and loading states.
- A non-authoritative Seeker model hint for presentation only.

The app intentionally exposes no program transaction button yet. No public
devnet/mainnet WokeSocial program ID is recorded in this repository, and the
legacy lamport-as-WOKE payment ABI is disabled. `$WOKE` requires a separately
specified SPL/Token-2022 mint and new typed program instructions.

## Configure

```sh
cp apps/mobile/.env.example apps/mobile/.env
```

Set the exact Solana program ID and matching deployment ID:

```text
wokenet:v1:<Solana genesis hash>:<WokeSocial program ID>
```

`EXPO_PUBLIC_*` values ship inside the app. Do not put RPC secrets in them.
Production endpoints must use HTTPS. Development builds may use HTTP only when
the app is running with `__DEV__`.

## Run

Mobile Wallet Adapter uses Android native modules, so Expo Go is not supported:

```sh
pnpm --filter @wokesocial/mobile android
pnpm --filter @wokesocial/mobile dev
```

Install an MWA-compatible wallet on the device or emulator. The deterministic
local test program key in this repository must never be used as a public
deployment authority.

## Verify

```sh
pnpm --filter @wokesocial/mobile lint
pnpm --filter @wokesocial/mobile typecheck
pnpm --filter @wokesocial/mobile test
pnpm --filter @wokesocial/mobile build
```

## APK

`eas.json` includes a `dapp-store` APK profile:

```sh
pnpm --filter @wokesocial/mobile build:apk
```

EAS project setup, Android signing credentials, store artwork, privacy/legal
review, device QA, and Solana dApp Store submission remain external release
steps. Use a signing key dedicated to the Solana dApp Store and never commit it.

`Platform.constants.Model === "Seeker"` is spoofable and must not gate value or
privileges. Any future verified Seeker entitlement must use wallet ownership
proof and server-side Seeker Genesis Token verification.
