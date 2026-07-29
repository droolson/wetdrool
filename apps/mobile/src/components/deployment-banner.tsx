import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { MobileRuntimeConfig } from '../runtime-config';
import { runtimeEndpointLabel } from '../runtime-config';
import { colors } from '../theme';
import type { MobileDeploymentState } from '../use-deployment';

interface DeploymentBannerProps {
  readonly config: MobileRuntimeConfig;
  readonly deployment: MobileDeploymentState;
}

export function DeploymentBanner({ config, deployment }: DeploymentBannerProps): React.JSX.Element {
  const verified = deployment.kind === 'verified';
  const label =
    deployment.kind === 'checking'
      ? 'Checking finalized Solana state'
      : verified
        ? `Program verified · slot ${deployment.slot.toLocaleString()}`
        : deployment.kind === 'unconfigured'
          ? 'Program deployment not configured'
          : deployment.kind === 'unavailable'
            ? 'Solana verification unavailable'
            : 'Solana deployment rejected';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, verified ? styles.verified : styles.caution]}
    >
      {deployment.kind === 'checking' ? (
        <ActivityIndicator color={colors.warning} size="small" />
      ) : (
        <View
          accessibilityLabel={verified ? 'Verified' : 'Attention required'}
          style={[styles.dot, verified ? styles.dotVerified : styles.dotCaution]}
        />
      )}
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text numberOfLines={1} style={styles.meta}>
          {config.chain.replace('solana:', '')} · {runtimeEndpointLabel(config.rpcUrl)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
    marginHorizontal: 20,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  caution: {
    backgroundColor: '#211C17',
    borderColor: '#55462D',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  dot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  dotCaution: {
    backgroundColor: colors.warning,
  },
  dotVerified: {
    backgroundColor: colors.accent,
  },
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  meta: {
    color: colors.muted,
    fontSize: 11,
    textTransform: 'lowercase',
  },
  verified: {
    backgroundColor: '#182014',
    borderColor: '#40572D',
  },
});
