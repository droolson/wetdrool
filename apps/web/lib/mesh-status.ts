/**
 * Web-facing mesh capability status (ADR-0014).
 * Prefer @wetdrool/mesh when built; fall back to inline honest report so web
 * typecheck does not require a prior package build in every environment.
 *
 * Relay readiness is configuration honesty only — never invents live peers,
 * multi-replica safety, or production mesh deployment.
 */

export interface MeshCapabilityReport {
  readonly foundation: 'anyproto/any-sync';
  readonly productionMeshDeployed: false;
  readonly localFirst: true;
  readonly e2eeSpaces: true;
  readonly transports: readonly ['local-only'];
  readonly notes: readonly string[];
}

export function getMeshCapabilityReport(): MeshCapabilityReport {
  return {
    foundation: 'anyproto/any-sync',
    productionMeshDeployed: false,
    localFirst: true,
    e2eeSpaces: true,
    transports: ['local-only'],
    notes: [
      'any-sync is the research foundation; production mesh is not deployed.',
      'Cloudflare/Vercel are HTTP bootstrap only.',
    ],
  };
}

/**
 * Honest relay endpoint configuration (no network probe, no peer inventory).
 * Empty / missing / invalid → configured: false.
 */
export interface RelayReadinessHonesty {
  /** True only when at least one valid ws/wss endpoint is present in env. */
  readonly configured: boolean;
  /** Display origins of valid relay endpoints (never credentials). */
  readonly displayEndpoints: readonly string[];
  readonly configuredCount: number;
  readonly invalidCount: number;
  /**
   * Relay keeps replay/connection state in-process — never multi-replica safe.
   * Always false; do not treat a configured URL as horizontal scale-out readiness.
   */
  readonly multiReplicaSafe: false;
  /** Live mesh peer count is never claimed by product APIs. */
  readonly liveMeshPeersClaimed: false;
  readonly livePeerCount: null;
  readonly productionMeshDeployed: false;
  readonly note: string;
}

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function describeRelayEndpoint(endpoint: URL): string {
  const defaultPort =
    ((endpoint.protocol === 'wss:') && endpoint.port === '443') ||
    ((endpoint.protocol === 'ws:') && endpoint.port === '80');
  const port = endpoint.port && !defaultPort ? `:${endpoint.port}` : '';
  return `${endpoint.protocol}//${endpoint.hostname}${port}`;
}

/**
 * Resolve WETDROOL_RELAY_ENDPOINTS honesty from raw env (no network probe).
 * Only ws: / wss: URLs without embedded credentials count as configured.
 */
export function resolveRelayReadinessHonesty(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RelayReadinessHonesty {
  const raw = env.WETDROOL_RELAY_ENDPOINTS?.trim() ?? '';
  if (!raw) {
    return {
      configured: false,
      displayEndpoints: [],
      configuredCount: 0,
      invalidCount: 0,
      multiReplicaSafe: false,
      liveMeshPeersClaimed: false,
      livePeerCount: null,
      productionMeshDeployed: false,
      note: 'Relay URL unset — mesh/relay product status is unconfigured, not a live peer mesh.',
    };
  }

  const displayEndpoints: string[] = [];
  let invalidCount = 0;
  let anyLoopback = false;

  for (const item of raw.split(',')) {
    const value = item.trim();
    if (!value) continue;
    try {
      const endpoint = new URL(value);
      if (endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:') {
        invalidCount += 1;
        continue;
      }
      if (endpoint.username || endpoint.password) {
        invalidCount += 1;
        continue;
      }
      if (isLoopbackHostname(endpoint.hostname)) {
        anyLoopback = true;
      }
      displayEndpoints.push(describeRelayEndpoint(endpoint));
    } catch {
      invalidCount += 1;
    }
  }

  if (displayEndpoints.length === 0) {
    return {
      configured: false,
      displayEndpoints: [],
      configuredCount: 0,
      invalidCount,
      multiReplicaSafe: false,
      liveMeshPeersClaimed: false,
      livePeerCount: null,
      productionMeshDeployed: false,
      note:
        invalidCount > 0
          ? 'Relay configuration present but no valid ws/wss endpoint — stays unconfigured; no live peers claimed.'
          : 'Relay URL empty after parse — unconfigured; no live peers claimed.',
    };
  }

  return {
    configured: true,
    displayEndpoints,
    configuredCount: displayEndpoints.length,
    invalidCount,
    multiReplicaSafe: false,
    liveMeshPeersClaimed: false,
    livePeerCount: null,
    productionMeshDeployed: false,
    note: anyLoopback
      ? 'Relay endpoint(s) configured (includes loopback). Configuration is not a health probe, not multi-replica safe, and does not invent live mesh peers.'
      : 'Relay endpoint(s) configured. Configuration is not a health probe, not multi-replica safe, and does not invent live mesh peers.',
  };
}
