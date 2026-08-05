import { describe, expect, it } from 'vitest';

import { PAIRWISE_PROTOCOL, ROOM_SEAL_PROTOCOL, getE2eeCapabilityReport } from '../lib/e2ee-status';
import { getAiIntegrationReport, DROOLY_AI_ORIGIN } from '../lib/drooly-bridge';

describe('e2ee capability report', () => {
  it('reports honest non-production web wiring', () => {
    const report = getE2eeCapabilityReport();
    expect(report.protocol).toBe(PAIRWISE_PROTOCOL);
    expect(report.pairwise).toBe('web_not_wired');
    expect(report.groupRooms).toBe('group_disabled');
    expect(report.serverReadableFallback).toBe(false);
    expect(report.privateByDefault).toBe(true);
    expect(report.details.length).toBeGreaterThan(0);
    expect(report.details.some((d) => d.includes('@wetdrool/messaging'))).toBe(true);
    expect(report.details.some((d) => /fake inbox/i.test(d))).toBe(true);
    expect(report.roomSealProtocol).toBe(ROOM_SEAL_PROTOCOL);
    expect(report.passphraseRooms).toBe('passphrase_rooms_alpha');
  });

  it('keeps seal protocol aligned with e2ee-seal SEAL_PROTOCOL constant name', async () => {
    const { SEAL_PROTOCOL } = await import('../lib/e2ee-seal');
    const report = getE2eeCapabilityReport();
    expect(report.roomSealProtocol).toBe(SEAL_PROTOCOL);
  });
});

describe('drooly bridge integration report', () => {
  it('keeps sibling AI on a separate origin without session sharing', () => {
    const report = getAiIntegrationReport();
    expect(report.crossOriginSessionSharing).toBe(false);
    expect(report.privateByDefault).toBe(true);
    const sibling = report.surfaces.find((s) => s.id === 'drooly-ai-chat');
    expect(sibling).toBeDefined();
    expect(sibling?.sameProduct).toBe(false);
    expect(sibling?.href.startsWith(DROOLY_AI_ORIGIN)).toBe(true);
    expect(report.surfaces.some((s) => s.id === 'wetdrool-dock')).toBe(true);
  });
});
