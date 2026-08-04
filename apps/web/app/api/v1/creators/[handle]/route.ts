import { getFounderStudio } from '@/lib/creator-economy';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(
  _request: Request,
  context: { params: Promise<{ handle: string }> },
): Promise<Response> {
  return context.params.then(({ handle }) => {
    const raw = handle?.trim() ?? '';
    if (raw === '' || raw.length > 96) {
      return jsonError(400, 'invalid_handle', 'Handle must be 1–96 characters.');
    }
    const founder = getFounderStudio();
    const normalized = raw.replace(/^@/, '').toLowerCase();
    if (normalized === founder.handle || normalized === 'kingofqueens6ix') {
      return jsonOk({ ok: true, profile: founder });
    }
    return jsonOk({
      ok: true,
      profile: {
        handle: raw.replace(/^@/, '').slice(0, 96),
        displayName: raw.replace(/^@/, '').slice(0, 96),
        pronouns: 'not set',
        bio: 'Creator surface awaiting signed profile + offerings.',
        tags: [],
        e2eeDms: true as const,
        jurisdictionNote: founder.jurisdictionNote,
        offerings: founder.offerings.map((o) => ({ ...o, status: 'staged' as const })),
      },
    });
  });
}
