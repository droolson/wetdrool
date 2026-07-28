# ADR-0008: Canonical Domain Transition

- **Status:** Accepted before public deployment
- **Date:** 2026-07-28
- **Owners:** Product, protocol, web, identity, security, and operations

## Context

The canonical public domain changed from `sociallywoke.com` to `woke.social`
before any native Woke public network, public account, or production WebAuthn deployment.
The prior hostname appeared not only in web metadata but also in portable-object
and relay cryptographic domain separators. Treating the two names as
interchangeable would create ambiguous signatures, topics, cookies, and relying
party authority.

## Decision

`https://woke.social` is the sole canonical flagship origin. The bare and `www`
forms of `sociallywoke.com` are discovery redirects only. They issue a permanent,
path/query-preserving redirect to `https://woke.social` and never serve a second
application, establish sessions, set application cookies, or act as WebAuthn
origins.

The application proxy compares an exact, syntactically bounded HTTP `Host`
value because a production Next.js server can normalize `request.nextUrl` to
its internal bind address. It never redirects substring, suffix, trailing-dot,
credential-like, or out-of-range-port variants. The destination host and scheme
are constants, so untrusted header text cannot become a redirect target.

Production WebAuthn uses RP ID `woke.social` and exact expected origin
`https://woke.social`. Preview, localhost, and independently operated client
hosts remain separate deployments and are never silently rewritten to the
flagship origin.

The pre-release cryptographic namespaces move in the same change:

- portable signed objects use `woke.social/protocol/signed-object`;
- the v1 JSON Schema identifier is hosted below `https://woke.social/`;
- relay topics use `woke.social/relay/topic/v1`; and
- relay signed envelopes use `woke.social/relay/signed-envelope`.

There is no compatibility alias for the old separators. Objects signed under
the experimental old domain are rejected and regenerated because accepting two
domains under one version would weaken domain separation. This is permissible
only because no public release or durable public deployment exists.

## Consequences

- Golden identifiers, signatures, relay topics, schemas, fixtures, and connected
  tests must be regenerated and pass together.
- Browser metadata and canonical URLs point only to `woke.social`.
- The legacy redirect must preserve ordinary paths and query parameters while
  rejecting header-driven open-redirect behavior.
- Cookie and CORS allowlists must not include the legacy host as an application
  origin.
- A future domain change after account or protocol deployment requires a new
  versioned migration design; DNS redirection alone cannot migrate WebAuthn
  credentials or cryptographic domains.
- DNS, TLS, mailboxes, and redirect deployment remain external production
  actions and are not claimed by repository tests.

## Rejected alternatives

- **Keep old cryptographic namespaces indefinitely:** contradicts the canonical
  product identity before first release and creates permanent legacy surface.
- **Accept both domains in v1 verification:** introduces signature ambiguity and
  downgrade behavior.
- **Serve the application on both domains:** splits cookies, CSP/CORS policy,
  analytics, canonical URLs, and WebAuthn relying-party expectations.
- **Redirect every unknown host:** breaks self-hosting and preview deployments
  and creates host-header risk.

## Verification

The gate requires:

1. no remaining `sociallywoke.com` use except explicit redirect/migration text
   and exact redirect-host tests;
2. generated schema drift checks and all protocol golden vectors passing;
3. relay protocol and loopback tests passing under the new domains;
4. exact-host tests plus a fresh `next start` HTTP probe proving `308`
   path/query-preserving redirects from both public legacy `Host` values while
   every other host passes through; and
5. authentication configuration evidence that the legacy host is not a
   production RP origin.
