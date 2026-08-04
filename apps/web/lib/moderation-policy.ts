/**
 * Platform moderation policy constants for WetDrool AI triage.
 * Human escalation is last resort; auto-resolve for clear hits.
 */

export type ModerationSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ModerationCategory =
  | 'csam'
  | 'nonconsensual_intimate'
  | 'hate'
  | 'harassment'
  | 'bullying'
  | 'bigotry'
  | 'doxxing'
  | 'scam'
  | 'spam'
  | 'illegal_other'
  | 'consent_boundary'
  | 'self_harm_crisis';

export interface PolicyRule {
  readonly id: string;
  readonly category: ModerationCategory;
  readonly severity: ModerationSeverity;
  readonly autoResolve: boolean;
  readonly humanLastResort: boolean;
  readonly summary: string;
}

export const MODERATION_RULES: readonly PolicyRule[] = [
  {
    id: 'pol-csam',
    category: 'csam',
    severity: 'critical',
    autoResolve: true,
    humanLastResort: true,
    summary: 'Any sexual content involving minors — zero tolerance, auto-remove, preserve evidence for legal process.',
  },
  {
    id: 'pol-ncii',
    category: 'nonconsensual_intimate',
    severity: 'critical',
    autoResolve: true,
    humanLastResort: true,
    summary: 'Non-consensual intimate imagery / deepfakes of real people without consent.',
  },
  {
    id: 'pol-hate',
    category: 'hate',
    severity: 'high',
    autoResolve: true,
    humanLastResort: true,
    summary: 'Hate speech targeting protected classes — not protected as “kink” or “edgy humor.”',
  },
  {
    id: 'pol-harass',
    category: 'harassment',
    severity: 'high',
    autoResolve: true,
    humanLastResort: true,
    summary: 'Targeted harassment, dogpiling, threats, stalking.',
  },
  {
    id: 'pol-bully',
    category: 'bullying',
    severity: 'medium',
    autoResolve: true,
    humanLastResort: true,
    summary: 'Bullying and sustained personal attacks.',
  },
  {
    id: 'pol-bigotry',
    category: 'bigotry',
    severity: 'high',
    autoResolve: true,
    humanLastResort: true,
    summary: 'Bigotry including anti-LGBTQ+ abuse, racism, misogyny, ableism as attack.',
  },
  {
    id: 'pol-dox',
    category: 'doxxing',
    severity: 'critical',
    autoResolve: true,
    humanLastResort: true,
    summary: 'Publishing private personal data to harm.',
  },
  {
    id: 'pol-scam',
    category: 'scam',
    severity: 'high',
    autoResolve: true,
    humanLastResort: false,
    summary: 'Fraud, phishing, wallet-drain social engineering.',
  },
  {
    id: 'pol-spam',
    category: 'spam',
    severity: 'low',
    autoResolve: true,
    humanLastResort: false,
    summary: 'Industrial spam and points-farm rings.',
  },
  {
    id: 'pol-crisis',
    category: 'self_harm_crisis',
    severity: 'high',
    autoResolve: false,
    humanLastResort: true,
    summary: 'Crisis signals — prioritize resources and support agent; do not punish seeking help.',
  },
] as const;

export const FREE_SPEECH_NOTE =
  'WetDrool allows almost complete freedom of consensual adult expression. Hate, bullying, bigotry, and harassment are not free speech on this platform.';

export const ESCALATION_ORDER = [
  'personal_controls',
  'ai_triage',
  'auto_resolve',
  'support_agent',
  'human_moderator',
] as const;
