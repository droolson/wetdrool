# WokeSocial media worker

`@wokesocial/media-worker` is a non-custodial media preparation service. It
accepts resumable byte uploads, verifies every chunk and the complete object,
validates MIME signatures, requires a real malware scanner, creates bounded
renditions, and publishes all deliverable bytes through
`@wokesocial/storage`.

The result contains protocol-valid **unsigned** `media-manifest` content and
the exact storage receipts. The worker never holds an identity key and never
signs on a user's behalf.

## Security defaults

The packaged server fails closed:

- startup requires a live ClamAV `clamd` service on a privately addressed TCP
  endpoint;
- startup requires a canonical base64url bearer token containing at least 32
  random bytes;
- CORS is disabled unless exact credential-free origins are configured;
- storage defaults to deletion-compatible local content-addressed storage;
- request bodies, authorization/cookie headers, and chunk digests are redacted
  from structured logs.

Configured CORS entries are revalidated at app construction even when callers
bypass the environment parser. Exact allowed origins may send bearer
authorization; wildcard, credential-bearing, and path-bearing origins are
rejected.

`GET /healthz` remains a liveness check. `GET /readyz` performs a bounded clamd
`PING` and returns `503` unless authorization is configured and the scanner,
storage, private processor working root, Sharp, FFmpeg, and ffprobe all pass
readiness.

Deployments should import `MediaWorkerService` and `buildMediaWorkerApp`, then
inject:

1. a purpose-appropriate authorization callback;
2. a `MalwareScanner` implementation that returns independently auditable
   pass/fail data;
3. `MultiProviderStorage` or a single `ContentAddressedStorage`;
4. deployment-specific staging and temporary roots.

Upload creation invokes authorization twice: `create` first supplies the
bounded media/storage declaration, then `claim` supplies the generated upload
ID. A deployment adapter should use `claim` to bind that ID to its authenticated
principal before the response is released. A rejected claim is cancelled and
its staged bytes are removed. Later actions always include the upload ID so the
adapter can enforce that binding.

The default `src/server.ts` composes `ClamdScanner` with
`StaticBearerAuthorization`. That authorization adapter intentionally
represents exactly one local/operator principal and keeps upload ownership in
process memory. It is suitable for a single-process local deployment, not a
multi-user or horizontally scaled service. A restart invalidates ownership of
incomplete staged uploads; they remain inaccessible and expire normally. Its
ownership set is capped at 100,000 IDs and fails later claims closed instead of
growing without bound.

## Packaged server configuration

These variables are required:

| Variable | Requirement |
| --- | --- |
| `MEDIA_WORKER_CLAMD_HOST` | DNS name or IP whose resolved addresses are all loopback, RFC 1918, or IPv6 ULA; link-local and public targets are rejected |
| `MEDIA_WORKER_STATIC_BEARER_TOKEN` | Canonical unpadded base64url encoding of 32–128 random bytes |

Generate a 48-byte operator token without printing it into application logs:

```sh
openssl rand -base64 48 | tr '+/' '-_' | tr -d '\n='
```

Send it as `Authorization: Bearer <token>`. The adapter hashes candidate and
configured tokens to fixed-length values before using a constant-time
comparison. The raw token, authorization header, request bodies, chunk
digests, uploaded bytes, clamd response text, and malware signature names are
not logged. After hashing it, the packaged server removes the token from its
process environment so FFmpeg and ffprobe children cannot inherit it.

Optional variables and their defaults are:

| Variable | Default | Bound |
| --- | ---: | ---: |
| `MEDIA_WORKER_HOST` | `127.0.0.1` (`0.0.0.0` in the image) | non-empty |
| `MEDIA_WORKER_PORT` | `4500` | 1–65535 |
| `MEDIA_WORKER_ALLOWED_ORIGINS` | empty/disabled | comma-separated exact HTTP(S) origins, for example `https://woke.social` |
| `MEDIA_WORKER_CLAMD_PORT` | `3310` | 1–65535 |
| `MEDIA_WORKER_CLAMD_CONNECT_TIMEOUT_MS` | `5000` | 1–60000 |
| `MEDIA_WORKER_CLAMD_SCAN_TIMEOUT_MS` | `120000` | 1–299000 |
| `MEDIA_WORKER_CLAMD_STREAM_MAX_BYTES` | `100000000` | 100000000–2000000000 |
| `MEDIA_WORKER_CLAMD_MAX_DATABASE_AGE_MS` | `259200000` (72 hours) | 3600000–2592000000 |
| `MEDIA_WORKER_STAGING_ROOT` | `.local/media-worker/staging` | private service-owned directory |
| `MEDIA_WORKER_TEMPORARY_ROOT` | `.local/media-worker/temporary` | private service-owned directory |
| `MEDIA_WORKER_STORAGE_ROOT` | `.local/media-worker/cas` | private service-owned directory |
| `MEDIA_WORKER_CLEANUP_INTERVAL_MS` | `900000` | 60000–86400000 |

The server performs a real clamd health check before listening. Missing
security variables, a weak token, a public scanner address, or an unavailable
daemon prevents startup; there is no development bypass.

### ClamAV compatibility

The public API maximum is **100,000,000 bytes**, reduced from the earlier
500 MB claim so it is compatible with a deliberately configured clamd. The
worker rejects a configured `MEDIA_WORKER_CLAMD_STREAM_MAX_BYTES` below that
API maximum and rejects an individual scan above the configured assertion
before connecting.

The daemon must independently be configured to accept and actually scan that
amount. At minimum, review these `clamd.conf` directives:

```text
TCPAddr <private-address-only>
TCPSocket 3310
StreamMaxLength 100000000
MaxFileSize 100000000
MaxScanSize 400M
AlertExceedsMax yes
```

`StreamMaxLength` is a daemon-side fact; the environment value does not change
clamd. If the daemon's stream limit is lower, clamd errors or closes and the
worker fails the scan closed. `AlertExceedsMax yes` is important because other
ClamAV analysis limits can otherwise skip work without turning the result into
a detection. Tune recursive scan limits and resources for the deployment, and
never expose clamd's unauthenticated TCP port outside an isolated private
network.

`ClamdScanner` uses NUL-framed `INSTREAM`, unsigned 32-bit network-byte-order
chunk lengths, a zero terminator, a 64 KiB chunk, bounded response bytes,
strict UTF-8/result parsing, separate connect and whole-scan deadlines, and
caller abort propagation. Readiness requires both `PING` and a strict
`VERSION` response whose database timestamp is no older than the configured
limit and no more than five minutes in the future. Run clamd in UTC; the
version protocol does not carry a timezone. Every scan queries `VERSION` before
and after `INSTREAM`, fails closed if it changes, and records bounded evidence
such as
`adapter=1;engine=1.5.3;db=28075;dbAt=2026-07-28T12:00:00.000Z`.

## OCI image

Build from the repository root:

```sh
docker build -f apps/media-worker/Dockerfile -t wokesocial-media-worker .
```

The multi-stage image uses the digest-pinned Node 22.23.1 bookworm-slim base,
pnpm 11.2.2, legacy workspace deployment, and Debian
`ffmpeg=7:5.1.9-0+deb12u1`. The runtime executes as the base image's unprivileged
`node` user, makes Node PID 1 so `SIGTERM` reaches the graceful shutdown
handler, and health-checks `/readyz`.

When the image is attached to its private clamd network, operators and CI can
run `node scripts/verify-clamd.mjs` inside the worker container. It streams both
a benign fixture and the standard harmless EICAR antivirus test pattern through
the production `ClamdScanner`, requires opposite verdicts, and verifies that
the adapter does not expose the daemon's signature name.

For a read-only root filesystem, mount writable, private storage at the three
configured `/var/lib/wokesocial` subdirectories and provide a bounded
temporary filesystem if the container runtime requires `/tmp`:

```sh
docker run --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --mount type=volume,src=media-staging,dst=/var/lib/wokesocial/staging \
  --mount type=volume,src=media-temporary,dst=/var/lib/wokesocial/temporary \
  --mount type=volume,src=media-cas,dst=/var/lib/wokesocial/cas \
  --network media-private \
  --env-file /path/to/chmod-0600-media-worker.env \
  -p 127.0.0.1:4500:4500 \
  wokesocial-media-worker
```

The environment file must contain the two required variables and should point
`MEDIA_WORKER_CLAMD_HOST` at a clamd service on `media-private`. Container
environment values remain visible to the container operator; use the
orchestrator's secret-injection facility and restrict operator access.

## Upload protocol

1. `POST /v1/uploads` declares up to 100,000,000 bytes, the whole-file
   multibase SHA-256, exact MIME type, processing mode, accessibility metadata,
   and storage policy. The response supplies a UUID upload ID and `Location`,
   `Upload-Offset`, `Upload-Length`, and `Upload-Expires` headers.
2. `PATCH /v1/uploads/{id}` requires
   `Content-Type: application/offset+octet-stream`, the exact current
   `Upload-Offset`, and `Upload-Chunk-Sha256`. Each accepted chunk is fsynced
   before the persisted offset advances. A stale offset returns `409` with the
   authoritative current offset.
3. `HEAD` or `GET /v1/uploads/{id}` resumes from the persisted offset.
4. `POST /v1/uploads/{id}/finalize` verifies the total size/hash, compares the
   declared type with byte sniffing, runs the injected scanner, processes
   bounded derivatives, and publishes them. Repeating a successful finalize is
   idempotent.
5. `DELETE /v1/uploads/{id}` serializes with append/finalize work and removes
   incomplete staged bytes. Completed content-addressed publications are not
   silently deleted.

Uploads expire after 24 hours by default. `cleanupExpired(maximumEntries)` is
batch-bounded; the packaged server invokes it periodically with a maximum of
100 records.

Staging roots and per-upload entries must be real private directories. Metadata
and staged-byte opens reject symbolic links and non-private hard-linked files,
chunk writes loop until every byte is committed, and the complete source is
rehashed after scanning and processing. A cleanup error cannot roll a durable
publication back to a publishable state; an idempotent finalize retry retries
cleanup without republishing. A single-node process restart can also recover a
persisted `processing` record and safely retry its content-addressed
publication.

## Processing profiles

The strict upload allowlist is JPEG, PNG, WebP, AVIF, MP4, WebM, MP3, M4A,
Ogg, WAV, and FLAC.

`managed` mode performs:

- Sharp autorotation, metadata-free re-encoding, a WebP thumbnail, and
  responsive WebP image variants;
- ffprobe stream/duration/dimension validation;
- H.264/AAC MP4 video re-encoding with source container metadata removed;
- a JPEG poster and single-rendition VOD HLS segments plus a CID-addressed
  playlist represented by the protocol's `hls-master` purpose;
- AAC-in-MP4 audio re-encoding and normalized peak waveform JSON.

Subprocesses are spawned with argument arrays, `shell: false`, ignored stdin,
and an FFmpeg/ffprobe file-only protocol allowlist. Input
dimensions/duration, per-artifact bytes, aggregate output bytes, segment count,
stdout/diagnostics, scanner time, and FFmpeg/ffprobe time are bounded.
Finalization concurrency is also bounded (two by default); excess work fails
fast with `worker-busy` instead of creating an unbounded in-memory queue.

`preprocessed` mode is the direct independent path. It validates byte
signatures, single-frame images by full decode, container boundaries where the
format exposes an exact length, stream structure, duration/dimensions, total
hash, and scan status, then publishes the exact submitted bytes. It requires
the client to explicitly assert that metadata was stripped. That assertion is
reported as such; the worker does not misrepresent it as centrally performed
processing.

Caption, subtitle, and description references are validated as protocol
content references and copied into the unsigned manifest content. The caller
is responsible for publishing and verifying those independently referenced
bytes. Images require alt text or a caption.

## Storage and manifest result

Deletion-compatible storage is the default. Permanent publication requires an
explicit consent ID and is delegated to the configured storage provider's
policy enforcement.

Every worker-produced deliverable has:

- CID, multibase SHA-256 digest, byte length, and media type;
- all verified provider receipts;
- provider failures that did not prevent the configured replication quorum;
- a `satisfied` or `degraded` replication state.

The worker independently computes the expected raw CID and rejects provider
receipts whose CID, byte length, verification flag, or storage policy differs
from the bytes and policy it supplied.

Clients must verify the receipts, construct the surrounding
`media-manifest` portable payload with their identity/sequence metadata, and
sign it themselves. The response fields `unsigned: true` and
`clientMustSign: true` make this boundary explicit.

## HTTP and OpenAPI

The generated OpenAPI 3.1 document is defined in `src/openapi.ts` and served at
`GET /openapi.json`. Other operational endpoints are:

- `GET /healthz`
- `GET /readyz`
- `GET /v1/policy`
- `POST /v1/uploads`
- `GET|HEAD|PATCH|DELETE /v1/uploads/{uploadId}`
- `POST /v1/uploads/{uploadId}/finalize`

Responses carry no-store, CSP, permissions-policy, referrer-policy,
cross-origin-resource-policy, and nosniff headers. Fastify body limits,
timeouts, CORS, and rate limits are applied before route work.

## Verification

```sh
pnpm --filter @wokesocial/media-worker lint
pnpm --filter @wokesocial/media-worker typecheck
pnpm --filter @wokesocial/media-worker test
pnpm --filter @wokesocial/media-worker test:integration
pnpm --filter @wokesocial/media-worker build
```

The integration suite explicitly checks the host for Sharp, FFmpeg, and
ffprobe. It runs real autorotation/metadata-stripping, audio transcode/waveform,
and video MP4/poster/HLS paths when detected; a missing binary is the only
reason the corresponding suite is skipped.

## Current deployment limitations

- Staging metadata and bytes are durable on one local filesystem. Horizontal
  workers need a shared transactional upload-state adapter and distributed
  lease before serving the same upload ID from multiple processes.
- The staging and temporary roots must be owned by a dedicated service account
  and inaccessible to other same-UID code. No-follow file opens and directory
  checks reduce link substitution, but Node path APIs do not provide a portable
  openat-style directory capability that eliminates every directory-component
  TOCTOU against a local process with the same filesystem authority.
- Cancellation serializes with active finalization work, and scanner timeouts
  signal abort. The packaged clamd adapter closes its file and socket on abort.
  A different injected scanner that ignores abort may continue its own
  out-of-process work after the worker releases the upload lock; custom
  adapters must treat abort as a requirement and avoid mutating staged bytes.
- Preprocessed bytes are intentionally not rewritten. Exact-boundary checks
  cover PNG, JPEG end markers, WebP/WAV RIFF lengths, and AVIF/MP4 ISO-BMFF
  boxes; formats with extensible or streaming containers still rely on full
  decoder validation and the mandatory malware scanner.
- FFmpeg and Sharp have time, input, output, dimension, duration, and diagnostic
  bounds, but the Node worker does not itself impose an operating-system memory
  or syscall sandbox. Production workers should run as a low-privilege,
  network-isolated service with filesystem and container resource limits.
- CID playlist entries require a client or gateway that resolves bare CIDs to
  a chosen storage provider.
- Scanner evidence is returned as operational metadata, not a signed
  `scannerStatement`. A scanner/provider may separately publish and sign such a
  protocol object.
- The packaged static bearer adapter has one process-local operator identity,
  process-local ownership bindings, and no per-user quota. Production
  authentication, durable multi-user ownership, quotas, and alternative
  scanner selection remain deployment policy and should be injected.
