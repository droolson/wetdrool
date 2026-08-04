---
tags: [wetdrool, marketplace, x402, e2ee, solana]
updated: 2026-08-04
---

# E2EE marketplace · x402 Solana payments

**UI:** `/market`  
**API:** `/api/v1/market`, `/api/v1/market/:id`

## Flow

1. **Seller** seals content client-side (middle-out + AES) with an unlock secret  
2. **POST** listing + sealed envelope + payTo + price SOL  
3. **Buyer** `GET` listing → **HTTP 402** + PaymentRequirements (x402-style)  
4. Buyer pays SOL on Solana to `payTo`  
5. Buyer retries with `X-PAYMENT` header (or POST `{ signature }`)  
6. Server verifies tx via RPC → returns envelope + unlock secret  
7. Buyer decrypts **client-side**

## Env

| Variable | Purpose |
| -------- | ------- |
| `WETDROOL_SOLANA_RPC_URL` | Confirm payments |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` / `mainnet-beta` |
| `WETDROOL_X402_DEV_ACCEPT=1` | Dev only: accept sig shape when no RPC |

## Related

- [[E2EE Rooms Middle-Out Edge]]
- [[Economy — Points and DROOL]]
