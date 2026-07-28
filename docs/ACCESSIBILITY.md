# Accessibility plan

Status: initial automated coverage implemented; full conformance testing is not
complete.

The implemented public/read-only route subset passes Playwright semantic,
skip-link, mobile-navigation, theme-state, and axe A/AA checks. The axe suite
currently runs against 45 route fixtures in both desktop and mobile Chromium,
for 90 scans. Connected post detail has semantic browser coverage but has not
joined the axe matrix. No manual assistive-technology matrix has been executed,
and these results do not establish WCAG 2.2 AA conformance for the product.

Socially Woke targets WCAG 2.2 Level AA across essential public, onboarding,
publishing, social, community, safety, messaging, payment, settings, export, and
deletion flows. Conformance is a launch gate, not a post-launch enhancement.

## Product rules

- Use semantic landmarks, headings, lists, buttons, links, tables, and forms.
- Every route has a descriptive title, one primary heading, and a skip link.
- All interaction is operable with keyboard alone, with logical order and
  visible focus that is not obscured.
- Dialogs trap focus while open, restore it on close, support Escape where safe,
  and have an accessible name and description.
- Dynamic status, validation, publication, upload, transaction, and moderation
  results are announced with appropriately scoped live regions.
- Form fields keep persistent labels. Errors identify the field, explain the
  correction, and are programmatically associated.
- Color is never the sole carrier of state or meaning.
- Text and meaningful UI meet AA contrast, including focus and disabled states.
- Layout survives 200% browser zoom and 400% text reflow without losing content
  or requiring two-dimensional scrolling except where intrinsically necessary.
- Pointer targets meet WCAG 2.2 target-size requirements; drag interactions have
  buttons or keyboard alternatives.
- Motion honors `prefers-reduced-motion`; no essential information depends on
  animation.
- Media supports captions, transcripts, alt text, audio descriptions where
  appropriate, and playback controls that do not auto-play sound.
- Feeds expose stable reading order and do not steal focus as content arrives.
- Virtualized lists retain meaningful positions and screen-reader behavior.
- Sensitive-content interstitials explain what is hidden without exposing it in
  accessible names or previews.
- Wallet and payment prompts describe the action, asset, recipient, amount, fee,
  network, and irreversibility in text.
- Directionality and layout are RTL-ready; identity terminology is localizable
  and never assembled from English-only fragments.

## Theme requirements

Light, dark, and high-contrast themes must all pass contrast checks. User theme,
contrast, text-size, motion, caption, and autoplay preferences are device-local
by default and exportable when explicitly chosen. Theme changes must not flash
or reset focus.

## Automated checks

Current and planned checks:

1. ESLint/Next rules run on JSX; broader dedicated accessibility rules remain to
   be evaluated.
2. Playwright covers the current skip link, mobile navigation, semantic route
   shell, and theme controls; component-level coverage must expand with the
   product.
3. Playwright plus axe scans 45 implemented route fixtures in desktop and
   mobile projects; dynamic post detail and every future route/state must join
   the matrix.
4. Story/component contrast checks for all token combinations.
5. HTML validation and duplicate-ID checks.
6. Tests for reduced motion, 200% zoom, forced colors, and high contrast.
7. A route crawler that fails CI on missing titles, primary headings, or skip
   targets.

Automated scans do not establish conformance on their own.

## Manual critical-flow matrix

Each flow must be completed at desktop and mobile widths with keyboard only,
VoiceOver on macOS/iOS, and one additional screen reader/browser combination:

- Create a passkey account and recover from validation errors.
- Complete an inclusive profile with custom and multiple pronoun sets.
- Follow a user and switch among chronological, following, and custom feeds.
- Publish text and media posts, including alt text, captions, content warning,
  audience, storage consent, retry, and failure recovery.
- Read a thread, react, repost, quote, bookmark, block, and mute.
- Create/join a community, review its rules, vote, report, and appeal.
- Send, verify, receive, and selectively report an encrypted message.
- Inspect a creator payment and reject or approve a wallet prompt.
- Configure providers, export data, revoke a device, rotate a key, and request
  deletion.
- Use the application while the primary RPC, indexer, gateway, or relay is down.

For every run, record browser, assistive technology, viewport, commit, result,
issue links, and tester. Keyboard traps, inaccessible authentication, missing
names, unsafe payment ambiguity, or loss of essential content are release
blockers.

## Evidence

Accessibility status is reported only from CI artifacts and signed-off manual
test records. The final report must list tested pages and flows, unresolved
exceptions, assistive-technology combinations, and dates.
