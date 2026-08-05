/**
 * Shared helpers for apps/web product API routes (/api/v1/*).
 * Fail-closed defaults; never invent mint or earnings claims.
 */

/** Stable product API surface ids (paths under /api/v1). Deduped, honest. */
export const PRODUCT_API_SURFACES = [
  { id: 'health', path: '/api/v1/health', methods: ['GET'] as const },
  { id: 'status', path: '/api/v1/status', methods: ['GET'] as const },
  { id: 'auth/status', path: '/api/v1/auth/status', methods: ['GET'] as const },
  { id: 'shorts', path: '/api/v1/shorts', methods: ['GET'] as const },
  { id: 'live', path: '/api/v1/live', methods: ['GET'] as const },
  { id: 'creators', path: '/api/v1/creators', methods: ['GET'] as const },
  { id: 'creators/:handle', path: '/api/v1/creators/:handle', methods: ['GET'] as const },
  { id: 'fame', path: '/api/v1/fame', methods: ['GET'] as const },
  { id: 'token', path: '/api/v1/token', methods: ['GET'] as const },
  { id: 'market', path: '/api/v1/market', methods: ['GET', 'POST'] as const },
  { id: 'market/:id', path: '/api/v1/market/:id', methods: ['GET', 'POST'] as const },
  { id: 'rooms/:roomId/messages', path: '/api/v1/rooms/:roomId/messages', methods: ['GET', 'POST'] as const },
  { id: 'e2ee', path: '/api/v1/e2ee', methods: ['GET'] as const },
  { id: 'policy/age', path: '/api/v1/policy/age', methods: ['GET'] as const },
  { id: 'ai/chat', path: '/api/v1/ai/chat', methods: ['POST'] as const },
] as const;

export type ProductApiSurfaceId = (typeof PRODUCT_API_SURFACES)[number]['id'];

/** Explicit honesty flags shared by health/status (no invented mint or earnings). */
export const PRODUCT_HONEST_FLAGS = {
  droolMint: 'does-not-exist' as const,
  droolMintInvented: false as const,
  earningClaimed: false as const,
  pointsAreNotToken: true as const,
  solIsNotDrool: true as const,
  /** $DROOL label is forbidden; SOL/lamports are never product currency names. */
  droolTickerForbidden: true as const,
};

export function listProductApiSurfaceIds(): readonly ProductApiSurfaceId[] {
  return PRODUCT_API_SURFACES.map((s) => s.id);
}

export function jsonOk(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { ...init, status: init.status ?? 200, headers });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  init: ResponseInit = {},
): Response {
  return jsonOk(
    {
      ok: false,
      error: { code, message, ...extra },
    },
    { ...init, status },
  );
}

/**
 * Standard 405 with Allow header. Prefer this over ad-hoc jsonError for method guards.
 */
export function methodNotAllowed(
  allow: string | readonly string[],
  message = 'Method not allowed.',
): Response {
  const allowValue = (Array.isArray(allow) ? allow : [allow]).join(', ');
  return jsonError(
    405,
    'method_not_allowed',
    message,
    { allow: allowValue.split(', ').filter(Boolean) },
    { headers: { Allow: allowValue } },
  );
}

export function parseLimit(raw: string | null, fallback = 24, max = 48): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parseOffset(raw: string | null, fallback = 0, max = 10_000): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Extract message from product API error JSON (client + tests). */
export function readProductApiErrorMessage(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof (body.error as { message: unknown }).message === 'string'
  ) {
    return (body.error as { message: string }).message;
  }
  return fallback;
}
