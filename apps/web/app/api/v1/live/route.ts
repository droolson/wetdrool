import { jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROOMS = [
  {
    id: 'room-pride-desk',
    title: 'Pride desk · soft stream',
    host: '@violetwave',
    nsfw: true,
    tags: ['pride', 'trans', 'chat'],
    viewersHint: 'staged',
    status: 'staged' as const,
  },
  {
    id: 'room-femboy-lofi',
    title: 'Femboy lofi hours',
    host: '@neonangel',
    nsfw: true,
    tags: ['femboy', 'lofi', 'tips'],
    viewersHint: 'staged',
    status: 'staged' as const,
  },
  {
    id: 'room-sfw-dev',
    title: 'Build-in-public (SFW)',
    host: '@droolhouse',
    nsfw: false,
    tags: ['sfw', 'dev', 'mesh'],
    viewersHint: 'staged',
    status: 'staged' as const,
  },
  {
    id: 'room-straight-after',
    title: 'After dark lounge',
    host: '@nightshift',
    nsfw: true,
    tags: ['straight', 'lounge'],
    viewersHint: 'staged',
    status: 'staged' as const,
  },
] as const;

export function GET(): Response {
  return jsonOk({
    ok: true,
    rooms: ROOMS,
    join: 'disabled',
    note: 'Live SFU / chat / tips not online. Cards are product scaffolding.',
  });
}
