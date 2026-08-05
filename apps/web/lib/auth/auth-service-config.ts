/**
 * Resolve and probe the replaceable authentication service for the web app.
 * Fail-closed on legacy hosts and invalid origins. Never invents "online".
 */

const LEGACY_REDIRECT_HOSTS = new Set(['droolhouse.com', 'www.droolhouse.com']);

export type AuthServiceReachability =
  | 'unconfigured'
  | 'invalid_origin'
  | 'unreachable'
  | 'degraded'
  | 'ready';

/** Suggested UI step derived from probe — never invents online ceremonies. */
export type AuthServiceNextStep =
  | 'configure_url'
  | 'start_auth_service'
  | 'wait_ready'
  | 'ready'
  | 'none';

/** Primary UI action for a next step (client may map to retry vs navigate). */
export type AuthServiceNextStepAction =
  | 'retry_probe'
  | 'open_devices'
  | 'open_providers'
  | 'open_signin'
  | 'open_onboarding'
  | 'configure_env';

export interface AuthServiceNextStepLink {
  readonly href: string;
  readonly label: string;
}

export interface AuthServiceNextStepGuidance {
  readonly nextStep: AuthServiceNextStep;
  /** Operator-facing explanation of what to do next. */
  readonly nextStepLabel: string;
  /** Short actionable line for banners (sign-in / onboarding / settings). */
  readonly actionSummary: string;
  /** Primary client action kind. */
  readonly primaryAction: AuthServiceNextStepAction;
  /**
   * Deep links shown when not ready / when ready.
   * configure_url links to providers only; env var names stay in copy (dev hint separate).
   */
  readonly links: readonly AuthServiceNextStepLink[];
  /**
   * When true, UI may show loopback/dev env-var configure hint.
   * Never shows production secrets; never treats legacy hosts as RP.
   */
  readonly showDevConfigureHint: boolean;
}

export interface AuthServiceConfig {
  /** Origin without trailing slash, e.g. http://localhost:4300 */
  readonly origin: string;
  readonly source:
    | 'WETDROOL_AUTH_URL'
    | 'NEXT_PUBLIC_AUTH_SERVICE_URL'
    | 'WOKESOCIAL_AUTH_URL'
    | 'default-localhost';
  readonly loopback: boolean;
}

export interface AuthServiceStatusReport {
  readonly ok: true;
  readonly product: 'wetdrool';
  readonly checkedAt: string;
  readonly configured: boolean;
  readonly origin: string | null;
  readonly source: AuthServiceConfig['source'] | null;
  readonly loopback: boolean;
  readonly reachability: AuthServiceReachability;
  readonly healthz: boolean | null;
  readonly readyz: boolean | null;
  readonly note: string;
  /** Protocol identity is never established by auth-service alone. */
  readonly protocolIdentityEstablished: false;
  readonly webAuthnOrigin: 'wetdrool.com' | 'local-dev' | 'unknown';
  readonly nextStep: AuthServiceNextStep;
  readonly nextStepLabel: string;
  readonly actionSummary: string;
  readonly primaryAction: AuthServiceNextStepAction;
  readonly links: readonly AuthServiceNextStepLink[];
  readonly showDevConfigureHint: boolean;
}

const DEV_CONFIGURE_HINT =
  'Local/dev only: set WETDROOL_AUTH_URL or NEXT_PUBLIC_AUTH_SERVICE_URL to https or loopback http (e.g. http://127.0.0.1:4300). Never use legacy redirect hosts as WebAuthn RP.';

export function devConfigureHintText(): string {
  return DEV_CONFIGURE_HINT;
}

/**
 * Suggested next step for UI. Labels are actionable (retry, open devices, configure in dev).
 * Never claims the product network is “online.”
 */
export function deriveAuthNextStep(
  reachability: AuthServiceReachability,
  options: { readonly loopback?: boolean } = {},
): AuthServiceNextStepGuidance {
  const loopback = options.loopback ?? false;

  switch (reachability) {
    case 'invalid_origin':
      return {
        nextStep: 'configure_url',
        nextStepLabel:
          'Fix WETDROOL_AUTH_URL / NEXT_PUBLIC_AUTH_SERVICE_URL (https or loopback http; never legacy redirect hosts).',
        actionSummary: 'Invalid auth origin — fix env, then retry the status probe.',
        primaryAction: 'configure_env',
        links: [
          { href: '/settings/providers', label: 'Provider settings' },
          { href: '/settings/devices', label: 'Passkeys & devices' },
        ],
        showDevConfigureHint: true,
      };
    case 'unconfigured':
      return {
        nextStep: 'configure_url',
        nextStepLabel: 'Set an auth service URL for this environment, then retry the probe.',
        actionSummary: 'Auth service unconfigured — set a valid origin, then open devices when ready.',
        primaryAction: 'configure_env',
        links: [
          { href: '/settings/providers', label: 'Provider settings' },
          { href: '/settings/devices', label: 'Passkeys & devices' },
        ],
        showDevConfigureHint: true,
      };
    case 'unreachable':
      return {
        nextStep: 'start_auth_service',
        nextStepLabel: loopback
          ? 'Start auth-service locally (port 4300), then use Retry probe. Or point env at a reachable origin.'
          : 'Start or restore the authentication service, then use Retry probe. Or set env to a reachable origin.',
        actionSummary: 'Auth service unreachable — start it, retry probe, then manage passkeys when ready.',
        primaryAction: 'retry_probe',
        links: [
          { href: '/settings/providers', label: 'Review connection readiness' },
          { href: '/settings/devices', label: 'Passkeys & devices' },
        ],
        showDevConfigureHint: loopback,
      };
    case 'degraded':
      return {
        nextStep: 'wait_ready',
        nextStepLabel:
          'Auth healthz ok but readyz failed — wait for store/rate-limit readiness, then Retry probe. Do not register yet.',
        actionSummary: 'Auth not ready — wait, retry probe; passkey create/sign-in stays fail-closed.',
        primaryAction: 'retry_probe',
        links: [
          { href: '/settings/providers', label: 'Review connection readiness' },
          { href: '/settings/devices', label: 'Passkeys & devices' },
        ],
        showDevConfigureHint: false,
      };
    case 'ready':
      return {
        nextStep: 'ready',
        nextStepLabel:
          'Auth service ready for passkey ceremonies when browser origin matches RP config. Protocol identity still separate.',
        actionSummary:
          'Passkey service ready — open devices to manage credentials, or sign in / create an account.',
        primaryAction: 'open_devices',
        links: [
          { href: '/settings/devices', label: 'Manage passkeys' },
          { href: '/signin', label: 'Sign in' },
          { href: '/onboarding', label: 'Create passkey account' },
        ],
        showDevConfigureHint: false,
      };
    default:
      return {
        nextStep: 'none',
        nextStepLabel: 'No suggested step.',
        actionSummary: 'No suggested auth next step.',
        primaryAction: 'retry_probe',
        links: [{ href: '/settings/providers', label: 'Provider settings' }],
        showDevConfigureHint: false,
      };
  }
}

/**
 * Human label for status UI. Never maps ready → "online" — health probes are
 * not a claim that the product network or protocol identity is live.
 */
export function reachabilityLabel(reachability: AuthServiceReachability): string {
  switch (reachability) {
    case 'ready':
      return 'Passkey service ready';
    case 'degraded':
      return 'Degraded — not ready';
    case 'unreachable':
      return 'Unreachable';
    case 'invalid_origin':
      return 'Invalid origin';
    case 'unconfigured':
      return 'Unconfigured';
  }
}

/** Short operator-facing explanation of probe bits. */
export function reachabilityDetail(report: AuthServiceStatusReport): string {
  switch (report.reachability) {
    case 'ready':
      return 'healthz and readyz both succeeded for the configured origin.';
    case 'degraded':
      return 'Process answered healthz, but readyz failed (store, rate-limit, or readiness gate).';
    case 'unreachable':
      return 'Neither healthz nor readyz returned a successful response.';
    case 'invalid_origin':
      return 'Configured URL failed origin validation (legacy hosts and non-loopback http are rejected).';
    case 'unconfigured':
      return 'No authentication service origin is configured.';
  }
}

/** Whether passkey registration/sign-in should be presented as available. */
export function passkeyCeremoniesAllowed(reachability: AuthServiceReachability): boolean {
  return reachability === 'ready';
}

function normalizeDnsHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, '');
}

function isLoopbackHost(hostname: string): boolean {
  const h = normalizeDnsHostname(hostname);
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * Validate auth service base URL (https or loopback http). Rejects legacy
 * redirect hosts and paths/query/userinfo.
 */
export function parseAuthServiceOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('invalid_auth_origin');
  }
  const hostname = normalizeDnsHostname(url.hostname);
  const local = isLoopbackHost(hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    LEGACY_REDIRECT_HOSTS.has(hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('invalid_auth_origin');
  }
  return url.origin;
}

export function resolveAuthServiceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthServiceConfig {
  const candidates: readonly {
    readonly key: AuthServiceConfig['source'];
    readonly value: string | undefined;
  }[] = [
    { key: 'WETDROOL_AUTH_URL', value: env.WETDROOL_AUTH_URL },
    { key: 'NEXT_PUBLIC_AUTH_SERVICE_URL', value: env.NEXT_PUBLIC_AUTH_SERVICE_URL },
    { key: 'WOKESOCIAL_AUTH_URL', value: env.WOKESOCIAL_AUTH_URL },
  ];

  for (const c of candidates) {
    const raw = c.value?.trim();
    if (!raw) continue;
    const origin = parseAuthServiceOrigin(raw);
    return {
      origin,
      source: c.key,
      loopback: isLoopbackHost(new URL(origin).hostname),
    };
  }

  const origin = parseAuthServiceOrigin('http://localhost:4300');
  return {
    origin,
    source: 'default-localhost',
    loopback: true,
  };
}

/** Prefer for Server Components / API routes (never throws). */
export function tryResolveAuthServiceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly ok: true; readonly config: AuthServiceConfig } | { readonly ok: false; readonly reason: string } {
  try {
    return { ok: true, config: resolveAuthServiceConfig(env) };
  } catch {
    return { ok: false, reason: 'invalid_auth_origin' };
  }
}

async function probeJsonOk(
  origin: string,
  path: '/healthz' | '/readyz',
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${origin}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return res.ok;
    if ('ok' in body && (body as { ok: unknown }).ok === false) return false;
    return true;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function attachNextStepFields(
  step: AuthServiceNextStepGuidance,
): Pick<
  AuthServiceStatusReport,
  'nextStep' | 'nextStepLabel' | 'actionSummary' | 'primaryAction' | 'links' | 'showDevConfigureHint'
> {
  return {
    nextStep: step.nextStep,
    nextStepLabel: step.nextStepLabel,
    actionSummary: step.actionSummary,
    primaryAction: step.primaryAction,
    links: step.links,
    showDevConfigureHint: step.showDevConfigureHint,
  };
}

export async function probeAuthServiceStatus(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  } = {},
): Promise<AuthServiceStatusReport> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const checkedAt = new Date().toISOString();

  const resolved = tryResolveAuthServiceConfig(env);
  if (!resolved.ok) {
    const step = deriveAuthNextStep('invalid_origin');
    return {
      ok: true,
      product: 'wetdrool',
      checkedAt,
      configured: false,
      origin: null,
      source: null,
      loopback: false,
      reachability: 'invalid_origin',
      healthz: null,
      readyz: null,
      note: 'Auth service URL is invalid or uses a forbidden host (legacy redirect hosts are never WebAuthn origins).',
      protocolIdentityEstablished: false,
      webAuthnOrigin: 'unknown',
      ...attachNextStepFields(step),
    };
  }

  const { config } = resolved;
  const healthz = await probeJsonOk(config.origin, '/healthz', fetchImpl, timeoutMs);
  const readyz = await probeJsonOk(config.origin, '/readyz', fetchImpl, timeoutMs);

  let reachability: AuthServiceReachability;
  if (healthz === null && readyz === null) {
    reachability = 'unreachable';
  } else if (healthz === true && readyz === true) {
    reachability = 'ready';
  } else if (healthz === true) {
    reachability = 'degraded';
  } else {
    reachability = 'unreachable';
  }

  const note =
    reachability === 'ready'
      ? 'Auth service healthz and readyz succeeded. Passkey ceremonies may proceed when this browser origin matches the relying-party config. This is not a claim that protocol identity or the public network is online.'
      : reachability === 'degraded'
        ? 'Auth service answered healthz but is not ready (store, migrations, or rate-limit). Fail closed: do not treat registration or sign-in as available until readyz is ok. Retry after the service finishes starting.'
        : reachability === 'unreachable'
          ? `Cannot reach ${config.origin}. Start auth-service locally (port 4300) or set WETDROOL_AUTH_URL / NEXT_PUBLIC_AUTH_SERVICE_URL to a valid origin. Status is unreachable — not “offline product,” just an unanswered probe.`
          : 'Auth service status unknown.';

  const step = deriveAuthNextStep(reachability, { loopback: config.loopback });
  return {
    ok: true,
    product: 'wetdrool',
    checkedAt,
    configured: config.source !== 'default-localhost',
    origin: config.origin,
    source: config.source,
    loopback: config.loopback,
    reachability,
    healthz,
    readyz,
    note,
    protocolIdentityEstablished: false,
    webAuthnOrigin: config.loopback ? 'local-dev' : 'wetdrool.com',
    ...attachNextStepFields(step),
  };
}
