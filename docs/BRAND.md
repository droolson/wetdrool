# Brand and interface direction

Status: initial brand and component subset implemented; full product system
remains in progress.

The current web/UI packages implement an original CSS mark and wordmark, shared
tokens, light/dark/high-contrast themes, reduced-motion rules, buttons, status
badges, provider cards, headings, and state panels. Playwright verifies the
high-contrast control on implemented web routes. An Expo/React Native Seeker
foundation exists but is not a release app and has no verified signed-APK/store
artifact. Full product-state coverage, mobile parity, originality/legal review,
and production asset packaging remain open.

WetDrool should feel bold, joyful, intelligent, defiant, welcoming, human,
contemporary, and trustworthy. The experience is open to everyone without
treating anyone's identity as a decorative motif or restricting the network to
a particular group.

## Core idea

**Own your voice. Choose your horizon.**

The visual system pairs editorial confidence with calm, legible product
surfaces. A strong wordmark and expressive display type provide character;
feeds, safety controls, publishing, and account-recovery flows remain quiet and
predictable.

## Visual system

- Use a warm near-black and paper-like neutral as structural colors.
- Use one electric violet-to-coral accent gradient sparingly for brand moments,
  selection, and progress—not as a background for every card.
- Use semantic colors with redundant icons and text for success, warning,
  danger, moderation, network, and verification states.
- Prefer generous spacing, decisive typography, visible hierarchy, and a small
  number of border radii over dense dashboard chrome.
- Use CSS geometry and an original wordmark treatment for the initial icon;
  avoid unlicensed illustration and rainbow cliché.
- Keep content cards recognizable but not copied pixel-for-pixel from another
  social platform.
- Represent varied bodies, races, ages, abilities, styles, and family
  structures when licensed or original imagery is introduced.

## Voice

- Plainspoken and precise, especially for permanence, encryption, moderation,
  payment, recovery, and network failure.
- Warm without forced cheerfulness.
- Firm about consent and abuse prevention.
- Never imply that blockchain makes a risky action safe or reversible.
- Never label SOL or lamports as `$DROOL`, imply a `$DROOL` mint exists, or present
  the quarantined legacy payment ABI as usable. Portable SOL/SPL metadata must
  name the real asset.
- Never imply that a Seeker build, signed APK, signing provenance, device
  certification, or store publication exists beyond recorded evidence.
- Never expose protocol jargon when an ordinary product phrase is sufficient.
- Do not infer or narrate identity attributes a person has not shared.

Examples:

- “Post” instead of “submit transaction.”
- “Choose where copies are stored” instead of “select a decentralized backend.”
- “This provider may keep permanent copies” before Arweave-compatible
  publication.
- “Your post is saved on this device and will retry when the network returns”
  for an offline draft.
- “Verify this conversation” instead of presenting raw key material without
  context.

## Required states

Every primary component and route has designed states for loading, empty,
partial, error, offline, stale, sensitive, blocked, deleted, revoked, pending,
confirmed, and degraded-provider behavior. Skeletons preserve layout and never
masquerade as real content. Error states explain what remains safe and what the
user can do next.

## Personal identity UX

- A person-selected name is the only default display name.
- Legal name is neither required nor implicitly requested.
- Optional profile details have independent audience controls and are excluded
  from inferred targeting.
- Current-profile views suppress superseded names. Historical signed revisions
  show a warning before reveal when immutable copies may contain old identity
  data.
- Relationship labels are customizable rather than forced into legal-family
  vocabulary.

## Originality review

Before release, compare the navigation, composer, post card, vertical viewer,
profile, icon, and wordmark against major social products. Similarity in common
interaction conventions is acceptable; protected names, marks, trade dress, and
pixel-level cloning are not.
