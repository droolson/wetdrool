import { MobileWalletProvider } from '@wallet-ui/react-native-web3js';
import { useMemo, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { BottomNavigation, type MobileRoute } from './src/components/bottom-navigation';
import { BrandHeader } from './src/components/brand-header';
import { DeploymentBanner } from './src/components/deployment-banner';
import { parseMobileRuntimeConfig, type MobileRuntimeEnvironment } from './src/runtime-config';
import { FeedScreen } from './src/screens/feed-screen';
import { WalletScreen } from './src/screens/wallet-screen';
import { colors } from './src/theme';
import { useSolanaDeployment } from './src/use-deployment';

const walletIdentity = {
  icon: 'icon.svg',
  name: 'WokeSocial',
  uri: 'https://woke.social',
} as const;

function runtimeEnvironment(): MobileRuntimeEnvironment {
  return {
    EXPO_PUBLIC_SOLANA_CHAIN: process.env.EXPO_PUBLIC_SOLANA_CHAIN,
    EXPO_PUBLIC_SOLANA_RPC_URL: process.env.EXPO_PUBLIC_SOLANA_RPC_URL,
    EXPO_PUBLIC_WOKENET_NETWORK_ID: process.env.EXPO_PUBLIC_WOKENET_NETWORK_ID,
    EXPO_PUBLIC_WOKENET_RPC_URL: process.env.EXPO_PUBLIC_WOKENET_RPC_URL,
    EXPO_PUBLIC_WOKESOCIAL_DEPLOYMENT_ID: process.env.EXPO_PUBLIC_WOKESOCIAL_DEPLOYMENT_ID,
    EXPO_PUBLIC_WOKESOCIAL_INDEXER_URL: process.env.EXPO_PUBLIC_WOKESOCIAL_INDEXER_URL,
    EXPO_PUBLIC_WOKESOCIAL_PROGRAM_ID: process.env.EXPO_PUBLIC_WOKESOCIAL_PROGRAM_ID,
  };
}

function ConfigurationError({ detail }: { readonly detail: string }): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor={colors.background} barStyle="light-content" />
      <BrandHeader />
      <View accessibilityLiveRegion="assertive" style={styles.configurationError}>
        <Text style={styles.configurationKicker}>CONFIGURATION REJECTED</Text>
        <Text accessibilityRole="header" style={styles.configurationTitle}>
          WokeSocial stayed fail-closed.
        </Text>
        <Text style={styles.configurationCopy}>{detail}</Text>
        <Text style={styles.configurationHint}>
          Correct the public Expo environment and rebuild the Android client.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function AppShell({
  config,
}: {
  readonly config: Extract<ReturnType<typeof parseMobileRuntimeConfig>, { kind: 'ready' }>['value'];
}): React.JSX.Element {
  const [route, setRoute] = useState<MobileRoute>('feed');
  const deployment = useSolanaDeployment(config);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor={colors.background} barStyle="light-content" />
      <BrandHeader />
      <DeploymentBanner config={config} deployment={deployment} />
      <View style={styles.screen}>
        {route === 'feed' ? (
          <FeedScreen config={config} deployment={deployment} />
        ) : (
          <WalletScreen config={config} deployment={deployment} />
        )}
      </View>
      <BottomNavigation onChange={setRoute} route={route} />
    </SafeAreaView>
  );
}

export default function App(): React.JSX.Element {
  const result = useMemo(
    () =>
      parseMobileRuntimeConfig(runtimeEnvironment(), {
        allowInsecureDevelopmentEndpoints: __DEV__,
      }),
    [],
  );
  if (result.kind === 'invalid') return <ConfigurationError detail={result.detail} />;

  return (
    <MobileWalletProvider
      chain={result.value.chain}
      endpoint={result.value.rpcUrl}
      identity={walletIdentity}
    >
      <AppShell config={result.value} />
    </MobileWalletProvider>
  );
}

const styles = StyleSheet.create({
  configurationCopy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
  },
  configurationError: {
    backgroundColor: colors.card,
    borderColor: colors.coral,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    margin: 20,
    padding: 22,
  },
  configurationHint: {
    color: colors.mutedInk,
    fontSize: 12,
    lineHeight: 18,
  },
  configurationKicker: {
    color: colors.coral,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  configurationTitle: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '900',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screen: {
    flex: 1,
  },
});
