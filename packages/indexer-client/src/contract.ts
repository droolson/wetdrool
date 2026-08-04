import {
  cidSchema,
  communityContentSchema,
  communityGovernanceStrategyCommitment,
  digestSchema,
  identityIdSchema,
  MAX_MEDIA_ITEMS,
  networkIdSchema,
  objectIdSchema,
  signingKeyIdSchema,
  solanaPublicKeySchema,
  timestampSchema,
  unsigned64Schema,
  type CommunityContent,
} from '@wetdrool/protocol';

/** Strict consumer-facing types and parsers for WetDrool indexer payloads. */

export type VerificationState = 'invalid' | 'pending' | 'verified';
export type Finality = 'confirmed' | 'finalized' | 'processed';
export type DegradedReason =
  'invalid-configuration' | 'invalid-response' | 'unavailable' | 'unconfigured';

export interface AnchorProof {
  finality: Finality;
  slot: number;
  transaction: string;
}

export interface PostVerification {
  anchor: AnchorProof | null;
  contentHash: string;
  contentHashValid: boolean;
  manifestUri: string;
  signatureValid: boolean;
  state: VerificationState;
}

export interface IndexedMedia {
  altText: string | null;
  bytes: number;
  cid: string;
  digest: string;
  mediaType: string;
}

export interface IndexedPost {
  author: {
    displayName: string;
    handle: string | null;
    identityId: string;
  };
  body: string | null;
  bodyReference: {
    bytes: number;
    cid: string;
    digest: string;
    mediaType: string;
  } | null;
  createdAt: string;
  id: string;
  language: string | null;
  media: IndexedMedia[];
  verification: PostVerification;
}

export interface IndexerMeta {
  checkpointSlot: number | null;
  indexedAt: string;
  source: string;
}

export interface FeedResponse {
  meta: IndexerMeta;
  posts: IndexedPost[];
}

export interface PostResponse {
  meta: IndexerMeta;
  post: IndexedPost;
}

export type SearchMatch =
  | 'community-description'
  | 'community-name'
  | 'community-slug'
  | 'display-name'
  | 'exact-identifier'
  | 'handle'
  | 'post-body'
  | 'profile-bio';

export interface SearchPerson {
  bio: string;
  displayName: string;
  handle: string | null;
  identityId: string;
  kind: 'person';
  matchedBy: SearchMatch;
  updatedAt: string;
}

export interface SearchPost {
  kind: 'post';
  matchedBy: SearchMatch;
  post: IndexedPost & { visibility: 'public' };
}

export type CommunitySearchMatch = Extract<
  SearchMatch,
  'community-description' | 'community-name' | 'community-slug'
>;

export interface VerifiedCommunity {
  communityAddress: string;
  content: CommunityContent;
  createdAt: string;
  createdSlot: string;
  creatorIdentityId: string;
  creatorSequence: string;
  governanceStrategyHash: string;
  governanceVersion: number;
  latestActionAuthority: string;
  membershipPolicy: 'invite' | 'open' | 'request';
  membershipPolicySequence: string;
  membershipSequence: string;
  manifestCid: string;
  manifestAuthority: string;
  manifestCreatedAt: string;
  manifestGovernanceStrategyHash: string;
  manifestGovernanceVersion: number;
  manifestHash: string;
  manifestVerified: true;
  networkId: string;
  objectId: string;
  schemaVersion: 2;
  signingKeyId: string;
  updatedAt: string;
  updatedSlot: string;
  visibility: 'private' | 'public' | 'unlisted';
}

export type PublicVerifiedCommunity = Omit<VerifiedCommunity, 'content'> & {
  content: CommunityContent & { visibility: 'public' };
};

export type DirectVerifiedCommunity = Omit<VerifiedCommunity, 'content'> & {
  content: CommunityContent & { visibility: 'public' | 'unlisted' };
};

export interface SearchCommunity {
  community: PublicVerifiedCommunity;
  kind: 'community';
  matchedBy: CommunitySearchMatch;
}

export type SearchItem = SearchCommunity | SearchPerson | SearchPost;

export interface SearchResponse {
  canonical: false;
  meta: IndexerMeta;
  network: string;
  query: string;
  ranking: {
    deterministic: true;
    version: 'public-match-v2';
  };
  results: SearchItem[];
  scope: 'public-finalized-projection';
}

export type PublicSearchQueryState =
  | { kind: 'empty'; query: '' }
  | {
      detail: string;
      kind: 'invalid';
      query: string;
      reason: 'ambiguous' | 'control-characters' | 'too-long' | 'too-short';
    }
  | { kind: 'valid'; query: string };

type UnknownRecord = Record<string, unknown>;

export const MAX_INDEXER_PAGE_ITEMS = 50;
const MAX_SEARCH_RESULTS = 50;
const MAX_BODY_LENGTH = 100_000;
const MIN_PUBLIC_SEARCH_QUERY_LENGTH = 3;
const MAX_PUBLIC_SEARCH_QUERY_LENGTH = 120;
const SEARCH_CONTROL_CHARACTERS = /\p{Cc}/u;

export class IndexerPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexerPayloadError';
  }
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IndexerPayloadError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, label: string, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new IndexerPayloadError(
      `${label} contains unsupported fields: ${unexpected.sort().join(', ')}.`,
    );
  }
}

function string(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new IndexerPayloadError(
      `${label} must be a non-empty string no longer than ${maximumLength} characters.`,
    );
  }
  return value;
}

function utf8String(value: unknown, label: string, maximumBytes: number): string {
  const candidate = string(value, label, maximumBytes);
  if (new TextEncoder().encode(candidate).byteLength > maximumBytes) {
    throw new IndexerPayloadError(`${label} must be no longer than ${maximumBytes} UTF-8 bytes.`);
  }
  return candidate;
}

function boundedString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new IndexerPayloadError(
      `${label} must be a string no longer than ${maximumLength} characters.`,
    );
  }
  return value;
}

function nullableString(value: unknown, label: string, maximumLength: number): string | null {
  return value === null ? null : string(value, label, maximumLength);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new IndexerPayloadError(`${label} must be a boolean.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new IndexerPayloadError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed === 0) {
    throw new IndexerPayloadError(`${label} must be a positive safe integer.`);
  }
  return parsed;
}

interface ProtocolSchema<T> {
  safeParse(value: unknown): { data: T; success: true } | { success: false };
}

function canonicalProtocolValue<T>(schema: ProtocolSchema<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(`${label} is not canonical protocol data.`);
  }
  return parsed.data;
}

function identityBelongsToNetwork(identityId: string, network: string): boolean {
  return identityId.startsWith(`wetdroolid:v1:${network}:`);
}

function parseBodyReference(value: unknown): IndexedPost['bodyReference'] {
  if (value === null) return null;
  const reference = record(value, 'post.bodyReference');
  return {
    bytes: nonNegativeInteger(reference.bytes, 'post.bodyReference.bytes'),
    cid: string(reference.cid, 'post.bodyReference.cid', 160),
    digest: string(reference.digest, 'post.bodyReference.digest', 160),
    mediaType: string(reference.mediaType, 'post.bodyReference.mediaType', 160),
  };
}

function parseMedia(value: unknown): IndexedMedia[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MEDIA_ITEMS) {
    throw new IndexerPayloadError(
      `post.media must be an array with at most ${MAX_MEDIA_ITEMS} items.`,
    );
  }
  return value.map((item, index) => {
    const media = record(item, `post.media[${index}]`);
    return {
      altText:
        media.altText === undefined
          ? null
          : boundedString(media.altText, `post.media[${index}].altText`, 2_000),
      bytes: nonNegativeInteger(media.bytes, `post.media[${index}].bytes`),
      cid: string(media.cid, `post.media[${index}].cid`, 160),
      digest: string(media.digest, `post.media[${index}].digest`, 160),
      mediaType: string(media.mediaType, `post.media[${index}].mediaType`, 160),
    };
  });
}

function validDate(value: unknown, label: string): string {
  const date = string(value, label, 64);
  if (Number.isNaN(Date.parse(date))) {
    throw new IndexerPayloadError(`${label} must be an ISO-compatible date.`);
  }
  return date;
}

function oneOf<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new IndexerPayloadError(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function parseAnchor(value: unknown): AnchorProof | null {
  if (value === null) return null;
  const anchor = record(value, 'verification.anchor');
  return {
    finality: oneOf(anchor.finality, 'verification.anchor.finality', [
      'processed',
      'confirmed',
      'finalized',
    ] as const),
    slot: nonNegativeInteger(anchor.slot, 'verification.anchor.slot'),
    transaction: string(anchor.transaction, 'verification.anchor.transaction', 160),
  };
}

export function parseIndexedPost(value: unknown): IndexedPost {
  const post = record(value, 'post');
  const author = record(post.author, 'post.author');
  const verification = record(post.verification, 'post.verification');
  const state = oneOf(verification.state, 'verification.state', [
    'verified',
    'pending',
    'invalid',
  ] as const);
  const signatureValid = boolean(verification.signatureValid, 'verification.signatureValid');
  const contentHashValid = boolean(verification.contentHashValid, 'verification.contentHashValid');
  const anchor = parseAnchor(verification.anchor);
  const body = nullableString(post.body, 'post.body', MAX_BODY_LENGTH);
  const bodyReference = parseBodyReference(post.bodyReference);
  const media = parseMedia(post.media);
  if (state === 'verified' && (!signatureValid || !contentHashValid || !anchor)) {
    throw new IndexerPayloadError(
      'A verified post requires valid signature and content hash checks plus an anchor proof.',
    );
  }
  if (body === null && bodyReference === null && media.length === 0) {
    throw new IndexerPayloadError('A post requires an inline body, body reference, or media.');
  }
  return {
    author: {
      displayName: utf8String(author.displayName, 'post.author.displayName', 160),
      handle: nullableString(author.handle, 'post.author.handle', 80),
      identityId: string(author.identityId, 'post.author.identityId', 300),
    },
    body,
    bodyReference,
    createdAt: validDate(post.createdAt, 'post.createdAt'),
    id: string(post.id, 'post.id', 180),
    language: nullableString(post.language, 'post.language', 35),
    media,
    verification: {
      anchor,
      contentHash: string(verification.contentHash, 'verification.contentHash', 160),
      contentHashValid,
      manifestUri: string(verification.manifestUri, 'verification.manifestUri', 500),
      signatureValid,
      state,
    },
  };
}

export function parseIndexerMeta(value: unknown): IndexerMeta {
  const meta = record(value, 'meta');
  return {
    checkpointSlot:
      meta.checkpointSlot === null
        ? null
        : nonNegativeInteger(meta.checkpointSlot, 'meta.checkpointSlot'),
    indexedAt: validDate(meta.indexedAt, 'meta.indexedAt'),
    source: string(meta.source, 'meta.source', 120),
  };
}

export function parseVerifiedCommunity(
  value: unknown,
  visibility: 'direct' | 'public' = 'direct',
): DirectVerifiedCommunity | PublicVerifiedCommunity {
  const community = record(value, 'community');
  exactKeys(community, 'community', [
    'communityAddress',
    'content',
    'createdAt',
    'createdSlot',
    'creatorIdentityId',
    'creatorSequence',
    'governanceStrategyHash',
    'governanceVersion',
    'latestActionAuthority',
    'membershipPolicy',
    'membershipPolicySequence',
    'membershipSequence',
    'manifestAuthority',
    'manifestCid',
    'manifestCreatedAt',
    'manifestGovernanceStrategyHash',
    'manifestGovernanceVersion',
    'manifestHash',
    'manifestVerified',
    'networkId',
    'objectId',
    'schemaVersion',
    'signingKeyId',
    'updatedAt',
    'updatedSlot',
    'visibility',
  ]);
  const networkId = canonicalProtocolValue(
    networkIdSchema,
    community.networkId,
    'community.networkId',
  );
  const communityAddress = canonicalProtocolValue(
    solanaPublicKeySchema,
    community.communityAddress,
    'community.communityAddress',
  );
  const creatorIdentityId = canonicalProtocolValue(
    identityIdSchema,
    community.creatorIdentityId,
    'community.creatorIdentityId',
  );
  if (!identityBelongsToNetwork(creatorIdentityId, networkId)) {
    throw new IndexerPayloadError(
      'A verified community creator belongs to a different DroolNet Solana deployment.',
    );
  }
  const latestActionAuthority = canonicalProtocolValue(
    solanaPublicKeySchema,
    community.latestActionAuthority,
    'community.latestActionAuthority',
  );
  const manifestAuthority = canonicalProtocolValue(
    solanaPublicKeySchema,
    community.manifestAuthority,
    'community.manifestAuthority',
  );
  const signingKeyId = canonicalProtocolValue(
    signingKeyIdSchema,
    community.signingKeyId,
    'community.signingKeyId',
  );
  if (signingKeyId !== `${creatorIdentityId}#root/${manifestAuthority}`) {
    throw new IndexerPayloadError(
      'A verified community must be signed by its creator identity root key at its immutable creation authority.',
    );
  }
  const manifestHash = canonicalProtocolValue(
    digestSchema,
    community.manifestHash,
    'community.manifestHash',
  );
  const objectId = canonicalProtocolValue(objectIdSchema, community.objectId, 'community.objectId');
  if (objectId !== `wetdroolobj:v1:community:${manifestHash}`) {
    throw new IndexerPayloadError(
      'A verified community object ID must bind to its anchored manifest hash.',
    );
  }
  if (community.manifestVerified !== true) {
    throw new IndexerPayloadError('A community requires an explicitly verified manifest.');
  }
  if (community.schemaVersion !== 2) {
    throw new IndexerPayloadError('A verified community requires schema version 2.');
  }
  const content = canonicalProtocolValue(
    communityContentSchema,
    community.content,
    'community.content',
  );
  if (
    community.visibility !== content.visibility ||
    community.membershipPolicy !== content.membershipPolicy
  ) {
    throw new IndexerPayloadError(
      'Effective onchain community discovery policy must match its verified creation manifest.',
    );
  }
  if (
    (visibility === 'public' && content.visibility !== 'public') ||
    (visibility === 'direct' &&
      content.visibility !== 'public' &&
      content.visibility !== 'unlisted')
  ) {
    throw new IndexerPayloadError(
      visibility === 'public'
        ? 'Community discovery accepts only explicitly public verified manifests.'
        : 'Direct community reads accept only public or unlisted verified manifests.',
    );
  }
  const createdSlot = canonicalProtocolValue(
    unsigned64Schema,
    community.createdSlot,
    'community.createdSlot',
  );
  const updatedSlot = canonicalProtocolValue(
    unsigned64Schema,
    community.updatedSlot,
    'community.updatedSlot',
  );
  if (BigInt(updatedSlot) < BigInt(createdSlot)) {
    throw new IndexerPayloadError(
      'A verified community update slot cannot precede its creation slot.',
    );
  }
  const creatorSequence = canonicalProtocolValue(
    unsigned64Schema,
    community.creatorSequence,
    'community.creatorSequence',
  );
  if (BigInt(creatorSequence) === 0n) {
    throw new IndexerPayloadError('A verified community creator sequence must be positive.');
  }
  const membershipPolicySequence = canonicalProtocolValue(
    unsigned64Schema,
    community.membershipPolicySequence,
    'community.membershipPolicySequence',
  );
  if (BigInt(membershipPolicySequence) === 0n) {
    throw new IndexerPayloadError('Community membership policy sequence must be positive.');
  }
  const membershipSequence = canonicalProtocolValue(
    unsigned64Schema,
    community.membershipSequence,
    'community.membershipSequence',
  );
  const createdAt = canonicalProtocolValue(
    timestampSchema,
    community.createdAt,
    'community.createdAt',
  );
  const updatedAt = canonicalProtocolValue(
    timestampSchema,
    community.updatedAt,
    'community.updatedAt',
  );
  if (updatedAt < createdAt) {
    throw new IndexerPayloadError(
      'A verified community update time cannot precede its creation time.',
    );
  }
  const governanceCommitment = communityGovernanceStrategyCommitment(content);
  const manifestGovernanceVersion = positiveInteger(
    community.manifestGovernanceVersion,
    'community.manifestGovernanceVersion',
  );
  const manifestGovernanceStrategyHash = canonicalProtocolValue(
    digestSchema,
    community.manifestGovernanceStrategyHash,
    'community.manifestGovernanceStrategyHash',
  );
  const governanceVersion = positiveInteger(
    community.governanceVersion,
    'community.governanceVersion',
  );
  const governanceStrategyHash = canonicalProtocolValue(
    digestSchema,
    community.governanceStrategyHash,
    'community.governanceStrategyHash',
  );
  if (
    manifestGovernanceVersion !== governanceCommitment.governanceVersion ||
    manifestGovernanceStrategyHash !== governanceCommitment.digest
  ) {
    throw new IndexerPayloadError(
      'A verified community manifest governance commitment must match its exact strategy.',
    );
  }
  if (
    governanceVersion < manifestGovernanceVersion ||
    (governanceVersion === manifestGovernanceVersion &&
      governanceStrategyHash !== manifestGovernanceStrategyHash)
  ) {
    throw new IndexerPayloadError(
      'Current community governance cannot precede or conflict with its creation commitment.',
    );
  }

  const parsed: VerifiedCommunity = {
    communityAddress,
    content,
    createdAt,
    createdSlot,
    creatorIdentityId,
    creatorSequence,
    governanceStrategyHash,
    governanceVersion,
    latestActionAuthority,
    membershipPolicy: content.membershipPolicy,
    membershipPolicySequence,
    membershipSequence,
    manifestAuthority,
    manifestCid: canonicalProtocolValue(cidSchema, community.manifestCid, 'community.manifestCid'),
    manifestCreatedAt: canonicalProtocolValue(
      timestampSchema,
      community.manifestCreatedAt,
      'community.manifestCreatedAt',
    ),
    manifestGovernanceStrategyHash,
    manifestGovernanceVersion,
    manifestHash,
    manifestVerified: true,
    networkId,
    objectId,
    schemaVersion: 2,
    signingKeyId,
    updatedAt,
    updatedSlot,
    visibility: content.visibility as 'public' | 'unlisted',
  };
  return parsed as DirectVerifiedCommunity | PublicVerifiedCommunity;
}

export function parseFeedResponse(value: unknown): FeedResponse {
  const response = record(value, 'response');
  if (!Array.isArray(response.posts) || response.posts.length > MAX_INDEXER_PAGE_ITEMS) {
    throw new IndexerPayloadError(
      `response.posts must be an array with at most ${MAX_INDEXER_PAGE_ITEMS} items.`,
    );
  }
  return { meta: parseIndexerMeta(response.meta), posts: response.posts.map(parseIndexedPost) };
}

export function parsePostResponse(value: unknown): PostResponse {
  const response = record(value, 'response');
  return { meta: parseIndexerMeta(response.meta), post: parseIndexedPost(response.post) };
}

export function validatePublicSearchQuery(
  value: string | readonly string[] | undefined,
): PublicSearchQueryState {
  if (value !== undefined && typeof value !== 'string') {
    return {
      detail: 'Submit exactly one public search query.',
      kind: 'invalid',
      query: '',
      reason: 'ambiguous',
    };
  }
  if (value === undefined) return { kind: 'empty', query: '' };
  const query = value
    .normalize('NFKC')
    .replace(/\p{Z}+/gu, ' ')
    .replace(/^ +| +$/gu, '')
    .replace(/[A-Z]/gu, (character) => character.toLowerCase());
  if (SEARCH_CONTROL_CHARACTERS.test(query)) {
    return {
      detail: 'Control characters are not allowed in a public search query.',
      kind: 'invalid',
      query: '',
      reason: 'control-characters',
    };
  }
  if (query.length === 0) return { kind: 'empty', query: '' };
  const queryLength = [...query].length;
  if (queryLength < MIN_PUBLIC_SEARCH_QUERY_LENGTH) {
    return {
      detail: `Use at least ${MIN_PUBLIC_SEARCH_QUERY_LENGTH} normalized Unicode code points.`,
      kind: 'invalid',
      query,
      reason: 'too-short',
    };
  }
  if (queryLength > MAX_PUBLIC_SEARCH_QUERY_LENGTH) {
    return {
      detail: `Use no more than ${MAX_PUBLIC_SEARCH_QUERY_LENGTH} normalized Unicode code points.`,
      kind: 'invalid',
      query,
      reason: 'too-long',
    };
  }
  return { kind: 'valid', query };
}

export function parseSearchResponse(
  value: unknown,
  expected?: { network: string },
): SearchResponse {
  const response = record(value, 'response');
  exactKeys(response, 'public search response', [
    'canonical',
    'meta',
    'network',
    'query',
    'ranking',
    'results',
    'scope',
  ]);
  const ranking = record(response.ranking, 'response.ranking');
  exactKeys(ranking, 'public search response.ranking', ['deterministic', 'version']);
  if (
    response.canonical !== false ||
    response.scope !== 'public-finalized-projection' ||
    ranking.deterministic !== true ||
    ranking.version !== 'public-match-v2' ||
    !Array.isArray(response.results) ||
    response.results.length > MAX_SEARCH_RESULTS
  ) {
    throw new IndexerPayloadError('The public search response metadata is invalid.');
  }
  const network = canonicalProtocolValue(
    networkIdSchema,
    response.network,
    'public search response.network',
  );
  if (expected !== undefined) {
    const expectedNetwork = canonicalProtocolValue(
      networkIdSchema,
      expected.network,
      'expected public search network',
    );
    if (network !== expectedNetwork) {
      throw new IndexerPayloadError('The public search response changed its requested network.');
    }
  }
  const responseQuery = string(response.query, 'response.query', 240);
  const queryState = validatePublicSearchQuery(responseQuery);
  if (queryState.kind !== 'valid' || queryState.query !== responseQuery) {
    throw new IndexerPayloadError('The public search response query is not canonical.');
  }
  const meta = parseIndexerMeta(response.meta);
  const results = response.results.map((item) => parseSearchItem(item, network));
  for (const result of results) {
    const requiredSlot =
      result.kind === 'community'
        ? BigInt(result.community.updatedSlot)
        : result.kind === 'post' && result.post.verification.anchor !== null
          ? BigInt(result.post.verification.anchor.slot)
          : null;
    if (
      requiredSlot !== null &&
      (meta.checkpointSlot === null || BigInt(meta.checkpointSlot) < requiredSlot)
    ) {
      throw new IndexerPayloadError(
        'The public search checkpoint does not cover every returned finalized object.',
      );
    }
  }
  const resultKeys = results.map((result) => {
    switch (result.kind) {
      case 'community':
        return `community:${result.community.networkId}:${result.community.communityAddress}`;
      case 'person':
        return `person:${result.identityId}`;
      case 'post':
        return `post:${result.post.id}`;
    }
  });
  if (new Set(resultKeys).size !== resultKeys.length) {
    throw new IndexerPayloadError('A public search response cannot repeat a result identifier.');
  }
  return {
    canonical: false,
    meta,
    network,
    query: responseQuery,
    ranking: { deterministic: true, version: 'public-match-v2' },
    results,
    scope: 'public-finalized-projection',
  };
}

function parseSearchItem(value: unknown, network: string): SearchItem {
  const item = record(value, 'search result');
  const kind = oneOf(item.kind, 'search result.kind', ['person', 'post', 'community'] as const);
  const matchedBy = oneOf(item.matchedBy, 'search result.matchedBy', [
    'community-description',
    'community-name',
    'community-slug',
    'display-name',
    'exact-identifier',
    'handle',
    'post-body',
    'profile-bio',
  ] as const);
  switch (kind) {
    case 'person': {
      exactKeys(item, 'person search result', [
        'bio',
        'displayName',
        'handle',
        'identityId',
        'kind',
        'matchedBy',
        'updatedAt',
      ]);
      if (!['display-name', 'exact-identifier', 'handle', 'profile-bio'].includes(matchedBy)) {
        throw new IndexerPayloadError('A person search result has an invalid match reason.');
      }
      const identityId = canonicalProtocolValue(
        identityIdSchema,
        item.identityId,
        'search result.identityId',
      );
      if (!identityBelongsToNetwork(identityId, network)) {
        throw new IndexerPayloadError(
          'A person search result belongs to a different DroolNet Solana deployment.',
        );
      }
      return {
        bio: boundedString(item.bio, 'search result.bio', 10_000),
        displayName: utf8String(item.displayName, 'search result.displayName', 160),
        handle: nullableString(item.handle, 'search result.handle', 30),
        identityId,
        kind,
        matchedBy,
        updatedAt: validDate(item.updatedAt, 'search result.updatedAt'),
      };
    }
    case 'post': {
      exactKeys(item, 'post search result', ['kind', 'matchedBy', 'post']);
      if (!['exact-identifier', 'post-body'].includes(matchedBy)) {
        throw new IndexerPayloadError('A post search result has an invalid match reason.');
      }
      const publicPost = record(item.post, 'search result.post');
      if (publicPost.visibility !== 'public') {
        throw new IndexerPayloadError(
          'A post search result requires an explicit public visibility claim.',
        );
      }
      const post = parseIndexedPost(publicPost);
      const postAuthor = canonicalProtocolValue(
        identityIdSchema,
        post.author.identityId,
        'search result.post.author.identityId',
      );
      if (!identityBelongsToNetwork(postAuthor, network)) {
        throw new IndexerPayloadError(
          'A post search result belongs to a different DroolNet Solana deployment.',
        );
      }
      if (
        post.verification.state !== 'verified' ||
        !post.verification.signatureValid ||
        !post.verification.contentHashValid ||
        post.verification.anchor?.finality !== 'finalized'
      ) {
        throw new IndexerPayloadError(
          'A post search result requires valid proofs and a finalized DroolNet anchor.',
        );
      }
      return { kind, matchedBy, post: { ...post, visibility: 'public' } };
    }
    case 'community': {
      if (!['community-description', 'community-name', 'community-slug'].includes(matchedBy)) {
        throw new IndexerPayloadError('A community search result has an invalid match reason.');
      }
      exactKeys(item, 'community search result', ['community', 'kind', 'matchedBy']);
      const community = parseVerifiedCommunity(item.community, 'public') as PublicVerifiedCommunity;
      if (community.networkId !== network) {
        throw new IndexerPayloadError(
          'A community search result belongs to a different DroolNet Solana deployment.',
        );
      }
      return {
        community,
        kind,
        matchedBy: matchedBy as CommunitySearchMatch,
      };
    }
  }
}

export function isValidPostId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,179}$/.test(id);
}

export function hasControlCharacters(value: string): boolean {
  return SEARCH_CONTROL_CHARACTERS.test(value);
}
