import type { IndexedPost } from '@wokesocial/indexer-client';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionButton } from '../components/action-button';
import type { MobileRuntimeConfig } from '../runtime-config';
import { colors, spacing } from '../theme';
import { useChronologicalFeed } from '../use-chronological-feed';
import type { MobileDeploymentState } from '../use-deployment';

interface FeedScreenProps {
  readonly config: MobileRuntimeConfig;
  readonly deployment: MobileDeploymentState;
}

function compactIdentity(identityId: string): string {
  const identity = identityId.split(':').at(-1) ?? identityId;
  return identity.length <= 14 ? identity : `${identity.slice(0, 7)}…${identity.slice(-5)}`;
}

function PostCard({ post }: { readonly post: IndexedPost }): React.JSX.Element {
  const slot = post.verification.anchor?.slot;
  return (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{post.author.displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.postAuthor}>
          <Text numberOfLines={1} style={styles.authorName}>
            {post.author.displayName}
          </Text>
          <Text numberOfLines={1} style={styles.authorMeta}>
            {post.author.handle === null
              ? compactIdentity(post.author.identityId)
              : `${post.author.handle}.woke`}
          </Text>
        </View>
        <Text style={styles.time}>
          {new Intl.DateTimeFormat(undefined, {
            day: 'numeric',
            month: 'short',
          }).format(new Date(post.createdAt))}
        </Text>
      </View>
      {post.body === null ? null : <Text style={styles.postBody}>{post.body}</Text>}
      {post.bodyReference === null ? null : (
        <View style={styles.attachment}>
          <Text style={styles.attachmentLabel}>Referenced text</Text>
          <Text numberOfLines={1} style={styles.attachmentMeta}>
            {post.bodyReference.mediaType} · {post.bodyReference.bytes.toLocaleString()} bytes
          </Text>
        </View>
      )}
      {post.media.map((media) => (
        <View key={`${media.cid}:${media.digest}`} style={styles.attachment}>
          <Text style={styles.attachmentLabel}>{media.altText ?? 'Media attachment'}</Text>
          <Text numberOfLines={1} style={styles.attachmentMeta}>
            {media.mediaType} · content-addressed
          </Text>
        </View>
      ))}
      <View style={styles.proofRow}>
        <Text style={styles.proof}>✓ signature · hash · Solana anchor</Text>
        <Text style={styles.proofSlot}>{slot === undefined ? '' : `slot ${slot}`}</Text>
      </View>
    </View>
  );
}

export function FeedScreen({ config, deployment }: FeedScreenProps): React.JSX.Element {
  const feed = useChronologicalFeed(config, deployment);
  const isRefreshing = feed.state.kind === 'loading' && feed.state.posts.length > 0;
  const initialLoading = feed.state.kind === 'loading' && feed.state.posts.length === 0;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          colors={[colors.accent]}
          onRefresh={feed.refresh}
          progressBackgroundColor={colors.cardRaised}
          refreshing={isRefreshing}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>PUBLIC · CHRONOLOGICAL</Text>
        <Text accessibilityRole="header" style={styles.title}>
          The timeline, without the tricks.
        </Text>
        <Text style={styles.intro}>
          Finalized posts from a replaceable open indexer. WokeSocial verifies the response before
          anything reaches this screen.
        </Text>
      </View>

      {initialLoading ? (
        <View accessibilityLiveRegion="polite" style={styles.stateCard}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.stateTitle}>Reading the verified projection</Text>
          <Text style={styles.stateCopy}>
            Checking signatures, hashes, anchors, and feed order.
          </Text>
        </View>
      ) : null}

      {feed.state.kind === 'blocked' || feed.state.kind === 'degraded' ? (
        <View accessibilityLiveRegion="polite" style={styles.stateCard}>
          <Text style={styles.stateKicker}>
            {feed.state.kind === 'blocked' ? 'NOT CONFIGURED' : 'DEGRADED'}
          </Text>
          <Text style={styles.stateTitle}>
            {feed.state.kind === 'blocked'
              ? 'The social feed is staying honest.'
              : 'The feed could not be trusted.'}
          </Text>
          <Text style={styles.stateCopy}>{feed.state.detail}</Text>
          <ActionButton
            accessibilityLabel="Retry the chronological feed"
            label="Try again"
            onPress={feed.refresh}
            tone="quiet"
          />
        </View>
      ) : null}

      {feed.state.posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}

      {feed.state.kind === 'ready' && feed.state.posts.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateKicker}>CAUGHT UP</Text>
          <Text style={styles.stateTitle}>No verified public posts yet.</Text>
          <Text style={styles.stateCopy}>
            This client will not invent demo people or posts while the projection is empty.
          </Text>
          <ActionButton
            accessibilityLabel="Refresh the empty chronological feed"
            label="Refresh"
            onPress={feed.refresh}
            tone="quiet"
          />
        </View>
      ) : null}

      {feed.state.kind === 'ready' && feed.state.posts.length > 0 ? (
        <View style={styles.feedFooter}>
          <Text style={styles.footerMeta}>
            Finalized checkpoint {feed.state.checkpointSlot.toLocaleString()} ·{' '}
            {feed.state.endpoint}
          </Text>
          {feed.state.nextCursor === null ? (
            <Text style={styles.endLabel}>You reached the end of this live keyset.</Text>
          ) : (
            <ActionButton
              accessibilityLabel="Load older chronological posts"
              label="Load older posts"
              onPress={feed.loadMore}
              tone="quiet"
            />
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  attachment: {
    backgroundColor: colors.cardRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 3,
    marginTop: 14,
    padding: 13,
  },
  attachmentLabel: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  attachmentMeta: {
    color: colors.muted,
    fontSize: 11,
  },
  authorMeta: {
    color: colors.muted,
    fontSize: 11,
  },
  authorName: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.coral,
    borderRadius: 14,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  avatarText: {
    color: '#281012',
    fontSize: 17,
    fontWeight: '900',
  },
  content: {
    paddingBottom: 110,
    paddingHorizontal: spacing.gutter,
  },
  endLabel: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  feedFooter: {
    gap: 13,
    paddingBottom: spacing.section,
    paddingTop: 8,
  },
  footerMeta: {
    color: colors.mutedInk,
    fontSize: 10,
    textAlign: 'center',
  },
  intro: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  postAuthor: {
    flex: 1,
    gap: 2,
  },
  postBody: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 24,
  },
  postCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 15,
    marginBottom: 14,
    padding: 17,
  },
  postHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
  },
  proof: {
    color: colors.cyan,
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  proofRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
  },
  proofSlot: {
    color: colors.mutedInk,
    fontSize: 10,
  },
  stateCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    marginBottom: 16,
    padding: 20,
  },
  stateCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  stateKicker: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  stateTitle: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '800',
  },
  time: {
    color: colors.mutedInk,
    fontSize: 11,
  },
  title: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -1.2,
    lineHeight: 36,
  },
  titleBlock: {
    gap: 10,
    paddingBottom: spacing.roomy,
    paddingTop: 8,
  },
});
