import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme';

interface ActionButtonProps {
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: 'accent' | 'quiet';
}

export function ActionButton({
  accessibilityLabel,
  disabled = false,
  label,
  onPress,
  tone = 'accent',
}: ActionButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        tone === 'quiet' ? styles.quiet : styles.accent,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Text style={tone === 'quiet' ? styles.quietLabel : styles.accentLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  accent: {
    backgroundColor: colors.accent,
  },
  accentLabel: {
    color: colors.accentInk,
    fontSize: 15,
    fontWeight: '800',
  },
  base: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  dimmed: {
    opacity: 0.55,
  },
  quiet: {
    backgroundColor: colors.cardRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
  quietLabel: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
});
