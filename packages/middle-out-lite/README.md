# `@wetdrool/middle-out-lite`

Portable **WokeNet middle-out** subset for WetDrool E2EE envelopes:

1. **Layer 1** — content-defined chunking + SHA-256 chunk IDs  
2. **Media passthrough** — JPEG/PNG/GIF/WebP/MP4/WebM stored as codec bytes (no re-encode)  
3. **Self-check** — decode-compare before accept (losslessness structural)

Full research package: `wokenet/packages/middle-out`. This lite package is edge-safe (Workers + Vercel).
