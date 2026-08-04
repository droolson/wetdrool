# DroolRank — Feed Algorithm

**Status:** Design baseline  
**Version:** 0.1  
**Last updated:** 2026-07-30

## Thesis

Most social algorithms optimize outrage or pure dwell. DroolRank optimizes **consensual pleasure, belonging, and creator diversity** while remaining inspectable.

## Modes

| Mode | Behavior |
|------|----------|
| **SFW** | Only content labeled SFW or dual; NSFW media scrubbed/hidden |
| **NSFW** | Full adult graph within user filters and safe-space rules |
| **Following** | Chronological + light quality, no discovery expansion |
| **Safe Space** | Membership + space policy gates before ranking |
| **Live** | Concurrent streams ranked by affinity × energy × safety |

## Score (simplified)

```
score = w1*affinity
      + w2*consent_fit
      + w3*quality
      + w4*creator_care
      - w5*safety_risk
      + w6*freshness
      - w7*points_farm_penalty
```

Weights are versioned config (`DROOLRANK_V`). Clients may show the version and top contributors.

### consent_fit

Intersection of:

- user NSFW/SFW mode
- kink/fetish allow and block lists
- orientation/identity safe-space membership
- content creator-applied tags (required for NSFW)

Mismatch → hard filter (not just downrank).

### quality

- completion rate, rewatch, positive reply ratio
- report rate inverted
- media technical quality (encode, captions when required)

### safety_risk

- hate/harassment model scores
- block/report graph proximity
- prior policy actions

### points_farm_penalty

Detects engagement that only exists to mint points (burst posting, mutual ring graphs).

## Explainability

Every ranked item can answer:

> Why am I seeing this?  
> 1. You follow adjacent creators in “…”  
> 2. Matches filters: …  
> 3. High completion in your session energy band  

## Anti-addiction (humane, not nerfed)

- Optional session timers
- Soft “take a breath” after extreme consecutive dwell
- Always-visible mental health links
- No infinite autoplay across **different** NSFW categories without a pause

## Evaluation gates before “revolutionary” claims

- Offline ranking metrics (diversity, filter precision, abuse escape rate)
- Human red-team for hate vs kink false positives
- Latency budget for home feed p95
EOF