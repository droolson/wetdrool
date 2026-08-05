import { resolveCreatorProfile } from '@/lib/creator-economy';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(
  _request: Request,
  context: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return context.params.then(({ handle }) => {
    const profile = resolveCreatorProfile(handle ?? '');
    if (!profile) {
      return jsonError(400, 'invalid_handle', 'Handle must be 1–96 chars [a-z0-9_-].');
    }
    const founder = profile.handle.toLowerCase() === 'kingofqueens6ix';
    return jsonOk({
      ok: true,
      profile,
      synthetic: !founder,
      checkoutLive: false,
      note: founder
        ? 'Founder preview studio. Checkout staged until mint + recipient verified.'
        : 'Staged placeholder from catalog fixtures. Awaiting signed portable profile.',
    });
  });
}

export function POST(): Response {
  return jsonError(405, 'method_not_allowed', 'Use GET for creator profiles.');
}
