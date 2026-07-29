import { useMobileWallet } from '@wallet-ui/react-native-web3js';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/action-button';
import type { MobileRuntimeConfig } from '../runtime-config';
import { runtimeEndpointLabel } from '../runtime-config';
import { hasSeekerDeviceHint } from '../seeker';
import { colors, spacing } from '../theme';
import type { MobileDeploymentState } from '../use-deployment';

interface WalletScreenProps {
  readonly config: MobileRuntimeConfig;
  readonly deployment: MobileDeploymentState;
}

function compactAddress(address: string): string {
  return address.length <= 18 ? address : `${address.slice(0, 9)}…${address.slice(-7)}`;
}

export function WalletScreen({ config, deployment }: WalletScreenProps): React.JSX.Element {
  const { account, connect, disconnect } = useMobileWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seekerHint = hasSeekerDeviceHint();

  const handleWalletAction = (): void => {
    setBusy(true);
    setError(null);
    const action = account === undefined ? connect() : disconnect();
    void Promise.resolve(action)
      .catch(() => {
        setError(
          account === undefined
            ? 'The wallet connection did not complete. No authorization was retained.'
            : 'The wallet could not be disconnected cleanly. Close the wallet and try again.',
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>SIGNER CONTROL</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Your wallet, without the mystery.
        </Text>
        <Text style={styles.intro}>
          Connect through Mobile Wallet Adapter. WokeSocial will never treat a wallet connection as
          consent to a transaction.
        </Text>
      </View>

      <View style={styles.walletCard}>
        <Text style={styles.cardKicker}>
          {account === undefined ? 'DISCONNECTED' : 'CONNECTED'}
        </Text>
        <Text style={styles.cardTitle}>
          {account === undefined ? 'Choose your Solana wallet' : 'Wallet authorization is active'}
        </Text>
        <Text style={styles.cardCopy}>
          {account === undefined
            ? 'The wallet app shows the authorization request. No WokeSocial program instruction is prepared or sent.'
            : compactAddress(account.address.toBase58())}
        </Text>
        <ActionButton
          accessibilityLabel={
            account === undefined ? 'Connect a Solana wallet' : 'Disconnect wallet'
          }
          disabled={busy}
          label={busy ? 'Working…' : account === undefined ? 'Connect wallet' : 'Disconnect'}
          onPress={handleWalletAction}
          tone={account === undefined ? 'accent' : 'quiet'}
        />
        {error === null ? null : (
          <Text accessibilityLiveRegion="assertive" style={styles.error}>
            {error}
          </Text>
        )}
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>A wallet is not your WokeSocial identity.</Text>
        <Text style={styles.noticeCopy}>
          Profiles, delegated keys, recovery, and privacy controls require a separate,
          consent-driven identity flow. This release does not silently create one from your address.
        </Text>
      </View>

      <View style={styles.detailsCard}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Solana cluster</Text>
          <Text style={styles.detailValue}>{config.chain.replace('solana:', '')}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>RPC</Text>
          <Text style={styles.detailValue}>{runtimeEndpointLabel(config.rpcUrl)}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Program</Text>
          <Text style={styles.detailValue}>
            {deployment.kind === 'verified' ? 'verified' : 'disabled'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Device</Text>
          <Text style={styles.detailValue}>
            {seekerHint ? 'Seeker hint detected' : 'Android compatible'}
          </Text>
        </View>
      </View>

      <Text style={styles.footnote}>
        The Seeker model string is a spoofable presentation hint, never proof of device or token
        ownership. No `$WOKE`, SOL tip, subscription, or other value transfer is enabled here.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cardCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  cardKicker: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: '800',
  },
  content: {
    paddingBottom: 110,
    paddingHorizontal: spacing.gutter,
  },
  detailLabel: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
  },
  detailRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 47,
  },
  detailValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'lowercase',
  },
  detailsCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 18,
    paddingHorizontal: 17,
  },
  error: {
    color: colors.coral,
    fontSize: 13,
    lineHeight: 19,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  footnote: {
    color: colors.mutedInk,
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  intro: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  notice: {
    backgroundColor: '#211C17',
    borderColor: '#55462D',
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    marginBottom: 18,
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
  walletCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    marginBottom: 18,
    padding: 20,
  },
});
