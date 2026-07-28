import type { AccountRecord, SessionRecord } from './models.js';
import {
  equalHash,
  hashSecret,
  parseSessionCookie,
  randomSessionId,
  randomToken,
  sessionCookieValue,
} from './security.js';
import type { AuthStore } from './store.js';

export interface IssuedSession {
  readonly session: SessionRecord;
  readonly cookieValue: string;
  readonly csrfToken: string;
}

export interface AuthenticatedSession {
  readonly session: SessionRecord;
  readonly account: AccountRecord;
}

export class SessionManager {
  constructor(
    private readonly store: AuthStore,
    private readonly sessionTtlMs: number,
    private readonly stepUpTtlMs: number,
  ) {}

  async create(accountId: string, now: Date, stepUp: boolean): Promise<IssuedSession> {
    const sessionId = randomSessionId();
    const secret = randomToken();
    const csrfToken = randomToken();
    const session: SessionRecord = {
      sessionId,
      accountId,
      secretHash: hashSecret(secret),
      csrfHash: hashSecret(csrfToken),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString(),
      lastAuthenticatedAt: now.toISOString(),
      ...(stepUp ? { stepUpAt: now.toISOString() } : {}),
    };
    await this.store.putSession(session);
    return {
      session,
      cookieValue: sessionCookieValue(sessionId, secret),
      csrfToken,
    };
  }

  async rotate(session: SessionRecord, now: Date, stepUp: boolean): Promise<IssuedSession> {
    const secret = randomToken();
    const csrfToken = randomToken();
    const rotated = await this.store.rotateSession({
      sessionId: session.sessionId,
      accountId: session.accountId,
      secretHash: hashSecret(secret),
      csrfHash: hashSecret(csrfToken),
      expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString(),
      authenticatedAt: now.toISOString(),
      stepUp,
    });
    return {
      session: rotated,
      cookieValue: sessionCookieValue(rotated.sessionId, secret),
      csrfToken,
    };
  }

  async resolve(
    cookieValue: string | undefined,
    now: Date,
  ): Promise<AuthenticatedSession | undefined> {
    const parsed = parseSessionCookie(cookieValue);
    if (parsed === undefined) return undefined;
    const session = await this.store.getSession(parsed.sessionId);
    if (
      session === undefined ||
      session.revokedAt !== undefined ||
      Date.parse(session.expiresAt) <= now.getTime() ||
      !equalHash(session.secretHash, hashSecret(parsed.secret))
    ) {
      return undefined;
    }
    const account = await this.store.getAccount(session.accountId);
    return account?.status === 'active' ? { session, account } : undefined;
  }

  validateCsrf(session: SessionRecord, token: string): boolean {
    return equalHash(session.csrfHash, hashSecret(token));
  }

  isFreshStepUp(session: SessionRecord, now: Date): boolean {
    const stepUp = session.stepUpAt === undefined ? Number.NaN : Date.parse(session.stepUpAt);
    return Number.isFinite(stepUp) && now.getTime() - stepUp <= this.stepUpTtlMs;
  }

  revoke(sessionId: string, now: Date): Promise<void> {
    return this.store.revokeSession(sessionId, now.toISOString());
  }
}
