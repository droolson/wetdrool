# Security Policy

## Current status

Socially Woke and Woke Network are pre-release software. No version is currently
supported for production Woke Network use, and no security control should be
considered verified without evidence in the release report. The design
requirements and threat model are in `docs/SECURITY.md` and
`docs/THREAT_MODEL.md`.

## Reporting a vulnerability

Do not disclose an unpatched vulnerability, exploit, credential, private key, private user
content, or personal information in a public issue.

GitHub private vulnerability reporting is the preferred channel when the repository exposes
the **Report a vulnerability** button on its Security page. The intended project mailbox is
`security@woke.social`, but it has not yet been verified. Do not send sensitive material
to that address until the project confirms it as operational. If private vulnerability
reporting is unavailable, the project currently has no verified secure intake channel; that is
an explicit production blocker.

A useful initial report includes:

- Affected revision, component, environment, and network.
- Preconditions and a minimal reproduction using synthetic data.
- Expected and observed impact.
- Whether exploitation may be active.
- Suggested remediation, if known.

Do not include seed phrases or private keys, test against accounts you do not control, access
more data than necessary, degrade service, or publish permanent harmful content.

## Response targets

These are intended targets and are not yet backed by an operating security team:

- Acknowledge a complete report within two business days.
- Triage critical or actively exploited reports as soon as safely possible.
- Provide a remediation or coordination update within seven days.
- Coordinate disclosure after affected operators and users have a reasonable mitigation
  window.

No bug bounty or safe-harbor program is currently funded or legally approved. Good-faith
research will be handled respectfully, but contributors must follow applicable law and avoid
privacy or service harm.

## Scope priorities

High-priority areas include:

- Wallet prompts, transaction substitution, payments, sponsorship, Woke Network
  programs, and native Firedancer validator/RPC behavior.
- Root identity, passkeys, delegated keys, recovery, and revocation.
- Private messaging, restricted-content encryption, and device membership.
- Signature, canonical serialization, manifest hash, CID, and indexer validation.
- Authorization, XSS, CSRF, SSRF, injection, path traversal, upload, and rate-limit bypasses.
- Program upgrade authority, CI/release compromise, secrets, and artifact provenance.
- Moderation-evidence exposure or bypass of user safety controls.

Issues that only affect unsupported local development defaults, dependency-version reports
without a reachable impact, and denial-of-service claims without a safe reproduction may
receive lower priority.

## Disclosure

Security fixes should include a regression test, affected-version statement, operator action,
and credit when the reporter wants it. Material protocol or production-authority incidents
must be documented publicly once doing so no longer creates additional user risk.
