import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme';

export function BrandHeader(): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View accessibilityElementsHidden style={styles.mark}>
        <Text style={styles.markLetter}>W</Text>
      </View>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.wordmark}>
          woke.social
        </Text>
        <Text style={styles.subline}>Human connection, anchored on Solana.</Text>
      </View>
      <View style={styles.networkPill}>
        <Text style={styles.networkPillText}>SOLANA</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    gap: 2,
  },
  mark: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 16,
    height: 48,
    justifyContent: 'center',
    transform: [{ rotate: '-5deg' }],
    width: 48,
  },
  markLetter: {
    color: colors.accentInk,
    fontSize: 23,
    fontWeight: '900',
  },
  networkPill: {
    borderColor: colors.cyan,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  networkPillText: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: spacing.gutter,
    paddingHorizontal: spacing.gutter,
    paddingTop: 12,
  },
  subline: {
    color: colors.muted,
    fontSize: 11,
  },
  wordmark: {
    color: colors.ink,
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
});
