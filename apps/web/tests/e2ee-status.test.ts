import { describe, expect, it } from 'vitest';

import { PAIRWISE_PROTOCOL, getE2eeCapabilityReport } from '../lib/e2ee-status';
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
