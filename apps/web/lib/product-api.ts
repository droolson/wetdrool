/**
 * Shared helpers for apps/web product API routes (/api/v1/*).
 */

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
): Response {
  return jsonOk(
    {
      ok: false,
      error: { code, message, ...extra },
    },
    { status },
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
