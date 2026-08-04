/**
 * Public docs catalog for wetdrool.com/docs.
 * Mirrors docs/obsidian + key specs without shipping the full monorepo tree.
 */

export interface DocsArticle {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly group: DocsGroupId;
  /** Path relative to repo docs/ for operators; may be obsidian/… */
  readonly repoPath: string;
  readonly tags: readonly string[];
}

export type DocsGroupId =
  | 'start'
  | 'product'
  | 'economy'
  | 'safety'
  | 'architecture'
  | 'deploy'
  | 'ai';

export interface DocsGroup {
  readonly id: DocsGroupId;
  readonly title: string;
  readonly blurb: string;
}

export const DOCS_GROUPS: readonly DocsGroup[] = [
  {
    id: 'start',
    title: 'Start here',
    blurb: 'What WetDrool is, priority order, and how to navigate the app.',
  },
  {
    id: 'product',
    title: 'Product surfaces',
    blurb: 'Hub, shorts, live, creators, private — the actual web app.',
  },
  {
    id: 'economy',
    title: 'Economy',
    blurb: 'Points, $DROOL, RevShare tax target, Pro mode.',
  },
  {
    id: 'safety',
    title: 'Safety & age',
    blurb: '18+ self-attest, hard bans, operator jurisdiction honesty.',
  },
  {
    id: 'architecture',
    title: 'Architecture & mesh',
    blurb: 'Authority planes, any-sync mesh, E2EE messaging.',
  },
  {
    id: 'deploy',
    title: 'Deploy & ops',
    blurb: 'Vercel, Cloudflare, GitHub, local dev runbooks.',
  },
  {
    id: 'ai',
    title: 'AI',
    blurb: 'In-app Drool vs sibling DROOLY.AI.',
  },
] as const;

export const DOCS_ARTICLES: readonly DocsArticle[] = [
  {
    id: 'home',
    title: 'Knowledge base home',
    summary: 'Obsidian index for the monorepo and public docs portal.',
    group: 'start',
    repoPath: 'obsidian/00 Home — WetDrool Knowledge Base.md',
    tags: ['index'],
  },
  {
    id: 'formula',
    title: 'Product formula',
    summary: 'RedGIFs + tube + Twitch18+ + OnlyFans + Reddit + X = wetdrool.com app.',
    group: 'start',
    repoPath: 'obsidian/Product Formula — Hub Shorts Live Creators Social.md',
    tags: ['product'],
  },
  {
    id: 'priority',
    title: 'Priority P1 → P5',
    summary: 'Web app first, then web3, Seeker, Android, iPhone.',
    group: 'start',
    repoPath: 'PRODUCT_PRIORITY.md',
    tags: ['roadmap'],
  },
  {
    id: 'hub',
    title: 'Hub catalog',
    summary: 'Pornhub/RedTube-density browse grid over portable manifests.',
    group: 'product',
    repoPath: 'obsidian/Surface — Hub Catalog.md',
    tags: ['hub'],
  },
  {
    id: 'shorts',
    title: 'Shorts (RedGIFs-class)',
    summary: 'Vertical discovery, Pride/Straight/All modes, ranking transparency.',
    group: 'product',
    repoPath: 'obsidian/Surface — Shorts RedGIFs.md',
    tags: ['shorts'],
  },
  {
    id: 'live',
    title: 'Live rooms',
    summary: '18+ livestream cards; join staged until SFU exists.',
    group: 'product',
    repoPath: 'obsidian/Surface — Live Rooms.md',
    tags: ['live'],
  },
  {
    id: 'creator',
    title: 'Creator studio',
    summary: 'Subscriptions, PPV, tips — decentralized OnlyFans-class surface.',
    group: 'product',
    repoPath: 'obsidian/Surface — Creator Studio.md',
    tags: ['creator'],
  },
  {
    id: 'private',
    title: 'Private E2EE',
    summary: 'Pairwise messaging capability report; no fake inbox.',
    group: 'product',
    repoPath: 'obsidian/Surface — Private E2EE.md',
    tags: ['e2ee'],
  },
  {
    id: 'economy',
    title: 'Points and $DROOL',
    summary: 'Ad-capped points; 3% tax target on RevShare; mint-pending rule.',
    group: 'economy',
    repoPath: 'obsidian/Economy — Points and DROOL.md',
    tags: ['token', 'points'],
  },
  {
    id: 'economy-spec',
    title: 'Economy specification',
    summary: 'Full points/ads/$DROOL spec.',
    group: 'economy',
    repoPath: 'ECONOMY.md',
    tags: ['spec'],
  },
  {
    id: 'age',
    title: 'Age access and hard bans',
    summary: 'Self-attest 18+, no gov ID by default, CSAM ban, Swiss honesty.',
    group: 'safety',
    repoPath: 'obsidian/Safety — Age Access and Hard Bans.md',
    tags: ['safety'],
  },
  {
    id: 'moderation',
    title: 'Moderation design',
    summary: 'Labels, reports, human escalation.',
    group: 'safety',
    repoPath: 'MODERATION.md',
    tags: ['moderation'],
  },
  {
    id: 'architecture',
    title: 'Authority planes',
    summary: 'Protocol vs projections vs private state.',
    group: 'architecture',
    repoPath: 'obsidian/Architecture — Authority Planes.md',
    tags: ['architecture'],
  },
  {
    id: 'mesh',
    title: 'any-sync mesh foundation',
    summary: 'Anytype stack as research foundation; not production mesh yet.',
    group: 'architecture',
    repoPath: 'obsidian/Mesh — any-sync Foundation.md',
    tags: ['p2p'],
  },
  {
    id: 'adr',
    title: 'ADR index',
    summary: 'Decision records 0001–0014.',
    group: 'architecture',
    repoPath: 'obsidian/ADR Index.md',
    tags: ['adr'],
  },
  {
    id: 'deploy',
    title: 'Vercel + Cloudflare',
    summary: 'Edge worker, DNS Full, origin URLs.',
    group: 'deploy',
    repoPath: 'obsidian/Deploy — Vercel and Cloudflare.md',
    tags: ['deploy'],
  },
  {
    id: 'runbook-dev',
    title: 'Local dev runbook',
    summary: 'pnpm dev, vitest loops.',
    group: 'deploy',
    repoPath: 'obsidian/Runbook — Local Dev.md',
    tags: ['dev'],
  },
  {
    id: 'runbook-push',
    title: 'GitHub and Vercel push',
    summary: 'How to track releases; why unattended dirty pushes are unsafe.',
    group: 'deploy',
    repoPath: 'obsidian/Runbook — GitHub and Vercel Push.md',
    tags: ['github', 'vercel'],
  },
  {
    id: 'ai',
    title: 'Drool and DROOLY.AI',
    summary: 'In-app AI vs sibling product boundary.',
    group: 'ai',
    repoPath: 'obsidian/AI — Drool and DROOLY.md',
    tags: ['ai'],
  },
  {
    id: 'brand',
    title: 'Brand identity',
    summary: 'Eye-in-heart mark, naming table, domains.',
    group: 'start',
    repoPath: 'obsidian/Brand — WetDrool Identity.md',
    tags: ['brand'],
  },
] as const;

export function articlesForGroup(group: DocsGroupId): readonly DocsArticle[] {
  return DOCS_ARTICLES.filter((a) => a.group === group);
}
