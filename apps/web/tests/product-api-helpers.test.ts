import { describe, expect, it } from 'vitest';

import {
  buildDiscoveryProviderHonesty,
  buildEmptyNotificationsInbox,
  buildMeshProductStatus,
  buildProductEventsResponse,
  buildProductHealthReport,
  buildProductStatusReport,
  jsonError,
  listProductApiSurfaceIds,
  methodNotAllowed,
  parseLimit,
  parseOffset,
  PRODUCT_API_LINKS,
  PRODUCT_API_SURFACES,
  PRODUCT_HONEST_FLAGS,
  readProductApiErrorMessage,
  resolveFeedPersonalizationHonesty,
} from '../lib/product-api';
import { resolveRelayReadinessHonesty } from '../lib/mesh-status';
import { rankShorts } from '../lib/short-feed';
import { getDroolTokenConfig, transferTaxAmount } from '../lib/drool-token';
import {
  FAME_SEED,
  fameTier,
  pageFameSeed,
  rankBoard,
  rankBoardWithSeed,
  emptyLocalProfile,
  type FameEntry,
} from '../lib/hall-of-fame';
import { LIVE_ROOMS, filterLiveRooms } from '../lib/live-catalog';
import {
  listCreatorDirectory,
  normalizeCreatorHandle,
  resolveCreatorProfile,
} from '../lib/creator-economy';

describe('product api helpers', () => {
  it('clamps limit', () => {
    expect(parseLimit(null)).toBe(24);
    expect(parseLimit('3')).toBe(3);
    expect(parseLimit('999', 24, 48)).toBe(48);
    expect(parseLimit('nope')).toBe(24);
  });

  it('clamps offset', () => {
    expect(parseOffset(null)).toBe(0);
    expect(parseOffset('5')).toBe(5);
    expect(parseOffset('-1')).toBe(0);
    expect(parseOffset('999999', 0, 100)).toBe(100);
  });

  it('jsonError shape is stable and methodNotAllowed sets Allow', async () => {
    const err = jsonError(400, 'bad', 'nope', { field: 'x' });
    expect(err.status).toBe(400);
    const errBody = (await err.json()) as {
      ok: false;
      error: { code: string; message: string; field?: string };
    };
    expect(errBody.ok).toBe(false);
    expect(errBody.error.code).toBe('bad');
    expect(errBody.error.message).toBe('nope');
    expect(errBody.error.field).toBe('x');

    const res = methodNotAllowed(['GET'], 'Use GET only.');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as {
      ok: false;
      error: { code: string; message: string; allow: string[] };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('method_not_allowed');
    expect(body.error.allow).toEqual(['GET']);
    expect(readProductApiErrorMessage(body, 'fallback')).toBe('Use GET only.');
    expect(readProductApiErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('product surface catalog is deduped and includes health + market write paths', () => {
    const ids = listProductApiSurfaceIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('health');
    expect(ids).toContain('status');
    expect(ids).toContain('auth/status');
    expect(ids).toContain('market');
    expect(ids).toContain('ai/chat');
    expect(ids).toContain('notifications');
    expect(ids).toContain('mesh');
    expect(ids).toContain('search');
    expect(ids).toContain('events');
    expect(ids).toContain('companions');
    expect(ids).not.toContain('social'); // not a real /api/v1 route
    const market = PRODUCT_API_SURFACES.find((s) => s.id === 'market');
    expect(market?.methods).toEqual(['GET', 'POST']);
    const health = PRODUCT_API_SURFACES.find((s) => s.id === 'health');
    expect(health?.methods).toEqual(['GET']);
  });

  it('notifications inbox stays empty and unconfigured (no invented social events)', () => {
    const empty = buildEmptyNotificationsInbox({ limit: 10, offset: 5, filter: 'mentions' });
    expect(empty.ok).toBe(true);
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.count).toBe(0);
    expect(empty.limit).toBe(10);
    expect(empty.offset).toBe(5);
    expect(empty.hasMore).toBe(false);
    expect(empty.filter).toBe('mentions');
    expect(empty.configured).toBe(false);
    expect(empty.delivery).toBe('none');
    expect(empty.unread).toBe(0);
    expect(empty.inventedSignals).toBe(false);
    expect(empty.pushLive).toBe(false);
    expect(empty.inAppLive).toBe(false);
    expect(empty.note.toLowerCase()).toMatch(/unconfigured|not live/);
    const defaults = buildEmptyNotificationsInbox();
    expect(defaults.limit).toBe(24);
    expect(defaults.offset).toBe(0);
    expect(defaults.filter).toBeNull();
    const notifications = PRODUCT_API_SURFACES.find((s) => s.id === 'notifications');
    expect(notifications?.path).toBe('/api/v1/notifications');
    expect(notifications?.methods).toEqual(['GET']);
    const health = buildProductHealthReport({});
    expect(health.surfaces).toContain('notifications');
    expect(health.links.notifications).toBe('/api/v1/notifications');
  });

  it('mesh surface reports honest relay readiness without inventing live peers', () => {
    const ids = listProductApiSurfaceIds();
    expect(ids).toContain('mesh');
    const meshSurface = PRODUCT_API_SURFACES.find((s) => s.id === 'mesh');
    expect(meshSurface?.path).toBe('/api/v1/mesh');
    expect(meshSurface?.methods).toEqual(['GET']);

    const unconfigured = buildMeshProductStatus({});
    expect(unconfigured.ok).toBe(true);
    expect(unconfigured.honest.configured).toBe(false);
    expect(unconfigured.relay.configured).toBe(false);
    expect(unconfigured.relay.multiReplicaSafe).toBe(false);
    expect(unconfigured.relay.liveMeshPeersClaimed).toBe(false);
    expect(unconfigured.relay.livePeerCount).toBeNull();
    expect(unconfigured.honest.multiReplicaSafe).toBe(false);
    expect(unconfigured.honest.inventsLivePeers).toBe(false);
    expect(unconfigured.mesh.productionMeshDeployed).toBe(false);
    expect(unconfigured.note.toLowerCase()).toMatch(/unconfigured|not a silent live mesh/);

    const withRelay = buildMeshProductStatus({
      WETDROOL_RELAY_ENDPOINTS: 'wss://relay.example/v1/relay',
    });
    expect(withRelay.relay.configured).toBe(true);
    expect(withRelay.honest.configured).toBe(true);
    expect(withRelay.relay.displayEndpoints).toEqual(['wss://relay.example']);
    expect(withRelay.relay.multiReplicaSafe).toBe(false);
    expect(withRelay.relay.liveMeshPeersClaimed).toBe(false);
    expect(withRelay.relay.livePeerCount).toBeNull();
    expect(withRelay.mesh.productionMeshDeployed).toBe(false);

    expect(resolveRelayReadinessHonesty({}).configured).toBe(false);
    expect(
      resolveRelayReadinessHonesty({ WETDROOL_RELAY_ENDPOINTS: 'https://not-ws.example' }).configured,
    ).toBe(false);
    expect(
      resolveRelayReadinessHonesty({
        WETDROOL_RELAY_ENDPOINTS: 'wss://name:secret@relay.example/v1/relay',
      }).configured,
    ).toBe(false);

    const health = buildProductHealthReport({});
    expect(health.surfaces).toContain('mesh');
    expect(health.links.mesh).toBe(PRODUCT_API_LINKS.mesh);
    expect(health.links.search).toBe(PRODUCT_API_LINKS.search);

    const status = buildProductStatusReport({});
    expect(status.surfaces).toContain('mesh');
    expect(status.surfaces).toContain('search');
    expect(status.links.mesh).toBe(PRODUCT_API_LINKS.mesh);
    expect(status.links.search).toBe(PRODUCT_API_LINKS.search);
    expect(status.stores.marketplace.multiReplicaSafe).toBe(false);
    expect(status.stores.rooms.multiReplicaSafe).toBe(false);
  });

  it('search surface is cataloged and linked from health/status without claiming a global index', () => {
    const ids = listProductApiSurfaceIds();
    expect(ids).toContain('search');
    const searchSurface = PRODUCT_API_SURFACES.find((s) => s.id === 'search');
    expect(searchSurface?.path).toBe('/api/v1/search');
    expect(searchSurface?.methods).toEqual(['GET']);
    expect(PRODUCT_API_LINKS.search).toBe('/api/v1/search');

    const health = buildProductHealthReport({});
    expect(health.surfaces).toContain('search');
    expect(health.links.search).toBe('/api/v1/search');
    expect(health.surfaceCatalog.some((s) => s.id === 'search' && s.path === '/api/v1/search')).toBe(
      true,
    );

    const status = buildProductStatusReport({});
    expect(status.surfaces).toContain('search');
    expect(status.links.search).toBe('/api/v1/search');
    expect(status.surfaceCatalog.some((s) => s.id === 'mesh')).toBe(true);
    expect(status.surfaceCatalog.some((s) => s.id === 'search')).toBe(true);
    // Store honesty: never multi-replica safe for process/file-local product stores.
    expect(status.stores.marketplace.multiReplicaSafe).toBe(false);
    expect(status.stores.rooms.multiReplicaSafe).toBe(false);
  });

  it('events surface is cataloged and never invents live attendance', () => {
    const ids = listProductApiSurfaceIds();
    expect(ids).toContain('events');
    const eventsSurface = PRODUCT_API_SURFACES.find((s) => s.id === 'events');
    expect(eventsSurface?.path).toBe('/api/v1/events');
    expect(eventsSurface?.methods).toEqual(['GET']);
    expect(PRODUCT_API_LINKS.events).toBe('/api/v1/events');

    const body = buildProductEventsResponse({ limit: 2, offset: 0 });
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(false);
    expect(body.syntheticOnly).toBe(true);
    expect(body.globalCalendar).toBe(false);
    expect(body.inventsLiveAttendance).toBe(false);
    expect(body.rsvpLive).toBe(false);
    expect(body.items.every((e) => e.synthetic === true)).toBe(true);
    expect(body.items.every((e) => e.liveAttendance === null)).toBe(true);

    const health = buildProductHealthReport({});
    expect(health.surfaces).toContain('events');
    expect(health.links.events).toBe('/api/v1/events');
    expect(health.surfaceCatalog.some((s) => s.id === 'events' && s.path === '/api/v1/events')).toBe(
      true,
    );

    const status = buildProductStatusReport({});
    expect(status.surfaces).toContain('events');
    expect(status.links.events).toBe('/api/v1/events');
  });

  it('companions surface is cataloged and never invents chat history or earnings', () => {
    const ids = listProductApiSurfaceIds();
    expect(ids).toContain('companions');
    const companionsSurface = PRODUCT_API_SURFACES.find((s) => s.id === 'companions');
    expect(companionsSurface?.path).toBe('/api/v1/companions');
    expect(companionsSurface?.methods).toEqual(['GET']);
    expect(PRODUCT_API_LINKS.companions).toBe('/api/v1/companions');

    const health = buildProductHealthReport({});
    expect(health.surfaces).toContain('companions');
    expect(health.links.companions).toBe('/api/v1/companions');
    expect(
      health.surfaceCatalog.some((s) => s.id === 'companions' && s.path === '/api/v1/companions'),
    ).toBe(true);

    const status = buildProductStatusReport({});
    expect(status.surfaces).toContain('companions');
    expect(status.links.companions).toBe('/api/v1/companions');
  });

  it('vanity surface is cataloged and stays registryLive false', () => {
    const ids = listProductApiSurfaceIds();
    expect(ids).toContain('vanity');
    const vanitySurface = PRODUCT_API_SURFACES.find((s) => s.id === 'vanity');
    expect(vanitySurface?.path).toBe('/api/v1/vanity');
    expect(vanitySurface?.methods).toEqual(['GET']);
    expect(PRODUCT_API_LINKS.vanity).toBe('/api/v1/vanity');

    const health = buildProductHealthReport({});
    expect(health.surfaces).toContain('vanity');
    expect(health.links.vanity).toBe('/api/v1/vanity');
    expect(
      health.surfaceCatalog.some((s) => s.id === 'vanity' && s.path === '/api/v1/vanity'),
    ).toBe(true);

    const status = buildProductStatusReport({});
    expect(status.surfaces).toContain('vanity');
    expect(status.links.vanity).toBe('/api/v1/vanity');
  });

  it('honest flags never invent $DROOL mint or earnings', () => {
    expect(PRODUCT_HONEST_FLAGS.droolMint).toBe('does-not-exist');
    expect(PRODUCT_HONEST_FLAGS.droolMintInvented).toBe(false);
    expect(PRODUCT_HONEST_FLAGS.earningClaimed).toBe(false);
    expect(PRODUCT_HONEST_FLAGS.solIsNotDrool).toBe(true);
    expect(PRODUCT_HONEST_FLAGS.droolTickerForbidden).toBe(true);
  });

  it('health aggregates store/auth flags without inventing mint/earnings', () => {
    const body = buildProductHealthReport({});
    expect(body.ok).toBe(true);
    expect(body.surfaces).toContain('health');
    expect(body.surfaces.filter((s) => s === 'creators').length).toBe(1);
    expect(body.droolMint).toBe('does-not-exist');
    expect(body.earningClaimed).toBe(false);
    expect(body.honest.droolMintInvented).toBe(false);
    expect(body.honest.earningClaimed).toBe(false);
    expect(body.honest.revenueReady).toBe(false);
    expect(body.honest.feedPersonalizationActive).toBe(false);
    expect(body.honest.shortsCatalogExternal).toBe(false);
    expect(body.revenueReady).toBe(false);
    expect(body.stores.marketplace.multiReplicaSafe).toBe(false);
    expect(body.stores.rooms.multiReplicaSafe).toBe(false);
    expect(body.auth.protocolIdentityEstablished).toBe(false);
    expect(body.auth.probePath).toBe('/api/v1/auth/status');
    expect(body.links.mesh).toBe('/api/v1/mesh');
    expect(body.links.search).toBe('/api/v1/search');
    expect(body.surfaces).toContain('mesh');
    expect(body.surfaces).toContain('search');
    expect(body.surfaceCatalog.some((s) => s.id === 'ai/chat' && s.methods.includes('POST'))).toBe(
      true,
    );
    expect(body.discovery.shorts.catalogMode).toBe('local-synthetic');
    expect(body.discovery.shorts.syntheticFixturesOnly).toBe(true);
    expect(body.discovery.shorts.ranking).toBe('local-droolrank-lite');
    expect(body.discovery.feedService.configured).toBe(false);
    expect(body.discovery.feedService.personalizationActive).toBe(false);
    expect(body.discovery.feedService.origin).toBeNull();
  });

  it('status aggregates stores + auth and never claims earnings', () => {
    const body = buildProductStatusReport({});
    expect(body.ok).toBe(true);
    expect(body.earningClaimed).toBe(false);
    expect(body.revenueReady).toBe(false);
    expect(body.checks.droolMint).toBe('does-not-exist');
    expect(body.stores.marketplace.multiReplicaSafe).toBe(false);
    expect(body.stores.rooms.multiReplicaSafe).toBe(false);
    expect(typeof body.stores.marketplace.listings).toBe('number');
    expect(body.stores.rooms.kind.length).toBeGreaterThan(0);
    expect(body.auth.protocolIdentityEstablished).toBe(false);
    expect(body.honest.droolMint).toBe('does-not-exist');
    expect(body.honest.earningClaimed).toBe(false);
    expect(body.honest.feedPersonalizationActive).toBe(false);
    expect(body.honest.shortsCatalogExternal).toBe(false);
    expect(body.discovery.shorts.catalogMode).toBe('local-synthetic');
    expect(body.discovery.feedService.configured).toBe(false);
    expect(body.discovery.feedService.personalizationActive).toBe(false);
    expect(body.surfaces).toContain('mesh');
    expect(body.surfaces).toContain('search');
    expect(body.links.mesh).toBe('/api/v1/mesh');
    expect(body.links.search).toBe('/api/v1/search');
    expect(body.links.health).toBe('/api/v1/health');
  });

  it('feed personalization is unconfigured without URL and never active today', () => {
    expect(resolveFeedPersonalizationHonesty({}).configured).toBe(false);
    expect(resolveFeedPersonalizationHonesty({ NEXT_PUBLIC_FEED_SERVICE_URL: '' }).configured).toBe(
      false,
    );
    expect(
      resolveFeedPersonalizationHonesty({ NEXT_PUBLIC_FEED_SERVICE_URL: 'not-a-url' }).configured,
    ).toBe(false);
    const loopback = resolveFeedPersonalizationHonesty({
      NEXT_PUBLIC_FEED_SERVICE_URL: 'http://localhost:4100',
    });
    expect(loopback.configured).toBe(true);
    expect(loopback.origin).toBe('http://localhost:4100');
    expect(loopback.personalizationActive).toBe(false);

    const discovery = buildDiscoveryProviderHonesty({
      NEXT_PUBLIC_FEED_SERVICE_URL: 'https://feed.wetdrool.com',
    });
    expect(discovery.feedService.configured).toBe(true);
    expect(discovery.feedService.origin).toBe('https://feed.wetdrool.com');
    expect(discovery.feedService.personalizationActive).toBe(false);
    expect(discovery.shorts.catalogMode).toBe('local-synthetic');
    expect(discovery.live.catalogMode).toBe('local-synthetic');
    expect(discovery.creators.syntheticFixturesOnly).toBe(true);
  });

  it('ranks shorts for api payload shape', () => {
    const items = rankShorts('pride', 5);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('score');
    expect(items[0]).toHaveProperty('synthetic');
    expect(items.every((c) => c.mode === 'pride' && c.synthetic)).toBe(true);
  });

  it('token tax is 3% and mint stays empty without env', () => {
    const cfg = getDroolTokenConfig({});
    expect(cfg.transferTaxBps).toBe(300);
    expect(transferTaxAmount(100)).toBe(3);
    expect(cfg.status).toBe('mint-pending');
    expect(cfg.mint).toBe('');
    expect(cfg.notClaims.some((c) => c.includes('never labeled'))).toBe(true);
  });

  it('fame board ranks seed', () => {
    const board = rankBoard(emptyLocalProfile(), '2026-08-04');
    expect(board[0]!.lifetimePoints).toBeGreaterThanOrEqual(board[1]!.lifetimePoints);
    expect(fameTier(FAME_SEED[0]!.lifetimePoints).length).toBeGreaterThan(0);
  });

  it('pages fame seed with ranks and no global ledger claim', () => {
    const page = pageFameSeed({ limit: 2, offset: 0 });
    expect(page.board).toHaveLength(2);
    expect(page.board[0]!.rank).toBe(1);
    expect(page.board[0]!.tier.length).toBeGreaterThan(0);
    expect(page.hasMore).toBe(true);
    expect(page.seedOnly).toBe(true);
    expect(page.globalLedger).toBe(false);
    const next = pageFameSeed({ limit: 2, offset: 2 });
    expect(next.board[0]!.rank).toBe(3);
  });

  it('merges api seed with local grinder and drops api local rows', () => {
    const apiSeed: FameEntry[] = [
      ...FAME_SEED,
      {
        handle: 'spoof',
        displayName: 'Spoof',
        lifetimePoints: 999999,
        streakDays: 1,
        badges: ['x'],
        source: 'local',
      },
    ];
    const local = {
      ...emptyLocalProfile(),
      handle: 'you',
      lifetimePoints: 500,
      checkinDays: ['2026-08-04'],
    };
    const board = rankBoardWithSeed(apiSeed, local, '2026-08-04');
    expect(board.some((e) => e.handle === 'spoof')).toBe(false);
    expect(board.some((e) => e.source === 'local' && e.handle === 'you')).toBe(true);
    expect(board[0]!.lifetimePoints).toBeGreaterThanOrEqual(board[board.length - 1]!.lifetimePoints);
  });

  it('live catalog filters nsfw when not allowed', () => {
    expect(LIVE_ROOMS.length).toBeGreaterThanOrEqual(2);
    const sfw = filterLiveRooms(LIVE_ROOMS, { nsfwAllowed: false });
    expect(sfw.every((r) => !r.nsfw)).toBe(true);
    const all = filterLiveRooms(LIVE_ROOMS, { nsfwAllowed: true });
    expect(all.length).toBe(LIVE_ROOMS.length);
  });

  it('lists synthetic creator directory and resolves handles', () => {
    const page = listCreatorDirectory({ limit: 10, offset: 0 });
    expect(page.synthetic).toBe(true);
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.some((c) => c.source === 'founder')).toBe(true);
    expect(normalizeCreatorHandle('@NeonAngel')).toBe('neonangel');
    expect(normalizeCreatorHandle('')).toBe(null);
    const founder = resolveCreatorProfile('kingofqueens6ix');
    expect(founder?.handle).toBe('kingofqueens6ix');
    expect(resolveCreatorProfile('../evil')).toBe(null);
  });

  it('pages creator directory with hasMore and empty trailing offset', () => {
    const first = listCreatorDirectory({ limit: 1, offset: 0 });
    expect(first.items).toHaveLength(1);
    expect(first.offset).toBe(0);
    expect(first.limit).toBe(1);
    expect(first.hasMore).toBe(first.total > 1);
    expect(first.q).toBe(null);

    const mid = listCreatorDirectory({ limit: 1, offset: 1 });
    expect(mid.items).toHaveLength(1);
    expect(mid.items[0]!.handle).not.toBe(first.items[0]!.handle);
    expect(mid.offset).toBe(1);

    const pastEnd = listCreatorDirectory({ limit: 10, offset: first.total });
    expect(pastEnd.items).toHaveLength(0);
    expect(pastEnd.hasMore).toBe(false);
    expect(pastEnd.total).toBe(first.total);
    expect(pastEnd.synthetic).toBe(true);
  });

  it('filters creator directory by q without inventing accounts', () => {
    const none = listCreatorDirectory({ limit: 10, offset: 0, q: 'definitely_not_a_fixture_zzz' });
    expect(none.total).toBe(0);
    expect(none.items).toHaveLength(0);
    expect(none.q).toBe('definitely_not_a_fixture_zzz');
    const founderish = listCreatorDirectory({ limit: 48, offset: 0, q: 'king' });
    expect(founderish.total).toBeGreaterThan(0);
    expect(founderish.items.every((c) => c.source === 'founder' || c.source === 'synthetic-catalog')).toBe(
      true,
    );
  });

  it('resolves non-founder profiles with normalized handle not display casing', () => {
    const profile = resolveCreatorProfile('@NeonAngel');
    expect(profile).not.toBeNull();
    expect(profile!.handle).toBe('neonangel');
    expect(profile!.offerings.every((o) => o.status === 'staged')).toBe(true);
  });
});
