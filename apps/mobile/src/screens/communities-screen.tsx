import type { PublicVerifiedCommunity } from '@wetdrool/indexer-client';
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
import { useCommunityDirectory } from '../use-community-directory';
import type { MobileDeploymentState } from '../use-deployment';

interface CommunitiesScreenProps {
  readonly config: MobileRuntimeConfig;
  readonly deployment: MobileDeploymentState;
}

function compactAddress(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-7)}`;
}

function CommunityCard({
  community,
}: {
  readonly community: PublicVerifiedCommunity;
}): React.JSX.Element {
  return (
    <View style={styles.communityCard}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{community.content.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.cardHeading}>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {community.content.name}
          </Text>
          <Text numberOfLines={1} style={styles.cardSlug}>
            /{community.content.slug}
          </Text>
        </View>
      </View>
      {community.content.description === '' ? null : (
        <Text style={styles.cardDescription}>{community.content.description}</Text>
      )}
      <View style={styles.policyRow}>
        <Text style={styles.policy}>
          {community.content.membershipPolicy === 'open'
            ? 'Open · member-signed'
            : community.content.membershipPolicy === 'request'
              ? 'Approval required'
              : 'Invite only'}
        </Text>
        <Text style={styles.address}>{compactAddress(community.communityAddress)}</Text>
      </View>
      <Text style={styles.proof}>✓ signed manifest · Solana anchor · verified provider</Text>
    </View>
  );
}

export function CommunitiesScreen({
  config,
  deployment,
}: CommunitiesScreenProps): React.JSX.Element {
  const directory = useCommunityDirectory(config, deployment);
  const isRefreshing = directory.state.kind === 'loading' && directory.state.communities.length > 0;
  const initialLoading =
    directory.state.kind === 'loading' && directory.state.communities.length === 0;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          colors={[colors.accent]}
          onRefresh={directory.refresh}
          progressBackgroundColor={colors.cardRaised}
          refreshing={isRefreshing}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>PUBLIC COMMUNITIES</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Find your people, with proof.
        </Text>
        <Text style={styles.intro}>
          Public community manifests from the configured WetDrool program. Names are friendly;
          Solana addresses remain the stable route.
        </Text>
      </View>

      {initialLoading ? (
        <View accessibilityLiveRegion="polite" style={styles.stateCard}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.stateTitle}>Reading verified communities</Text>
          <Text style={styles.stateCopy}>
            Checking manifest signatures, anchors, and page order.
          </Text>
        </View>
      ) : null}

      {directory.state.kind === 'blocked' || directory.state.kind === 'degraded' ? (
        <View accessibilityLiveRegion="polite" style={styles.stateCard}>
          <Text style={styles.stateKicker}>
            {directory.state.kind === 'blocked' ? 'NOT CONFIGURED' : 'DEGRADED'}
          </Text>
          <Text style={styles.stateTitle}>Community discovery stayed fail-closed.</Text>
          <Text style={styles.stateCopy}>{directory.state.detail}</Text>
          <ActionButton
            accessibilityLabel="Retry community discovery"
            label="Try again"
            onPress={directory.refresh}
            tone="quiet"
          />
        </View>
      ) : null}

      {directory.state.communities.map((community) => (
        <CommunityCard community={community} key={community.communityAddress} />
      ))}

      {directory.state.kind === 'ready' && directory.state.communities.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateKicker}>QUIET FOR NOW</Text>
          <Text style={styles.stateTitle}>No verified public communities yet.</Text>
          <Text style={styles.stateCopy}>
            This app will not substitute demo groups while the live directory is empty.
          </Text>
          <ActionButton
            accessibilityLabel="Refresh the empty community directory"
            label="Refresh"
            onPress={directory.refresh}
            tone="quiet"
          />
        </View>
      ) : null}

      {directory.state.kind === 'ready' && directory.state.communities.length > 0 ? (
        <View style={styles.footer}>
          <Text style={styles.footerMeta}>
            Finalized checkpoint {directory.state.checkpointSlot.toLocaleString()} ·{' '}
            {directory.state.endpoint}
          </Text>
          {directory.state.nextCursor === null ? (
            <Text style={styles.endLabel}>That is every community in this live page set.</Text>
          ) : (
            <ActionButton
              accessibilityLabel="Load older verified communities"
              label="Load more communities"
              onPress={directory.loadMore}
              tone="quiet"
            />
          )}
        </View>
      ) : null}

      <View style={styles.membershipNotice}>
        <Text style={styles.noticeTitle}>Joining still asks for deliberate consent.</Text>
        <Text style={styles.noticeCopy}>
          The member-signed Solana contract is implemented, but this mobile screen remains read-only
          until identity selection, exact manifest signing, simulation, MWA transaction approval,
          finality, and indexer catch-up are wired together.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  address: {
    color: colors.mutedInk,
    fontSize: 10,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.cyan,
    borderRadius: 15,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  avatarText: {
    color: '#092422',
    fontSize: 18,
    fontWeight: '900',
  },
  cardDescription: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  cardHeading: {
    flex: 1,
    gap: 2,
  },
  cardSlug: {
    color: colors.muted,
    fontSize: 11,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  communityCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    marginBottom: 14,
    padding: 17,
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
  footer: {
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
  membershipNotice: {
    backgroundColor: '#211C17',
    borderColor: '#55462D',
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    marginBottom: spacing.section,
    padding: 17,
  },
  noticeCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  noticeTitle: {
    color: colors.warning,
    fontSize: 15,
    fontWeight: '800',
  },
  policy: {
    color: colors.accent,
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  policyRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
  },
  proof: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: '700',
  },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    marginBottom: 18,
    padding: 22,
  },
  stateCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  stateKicker: {
    color: colors.coral,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  stateTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
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
