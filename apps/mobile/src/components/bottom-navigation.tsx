import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

export type MobileRoute = 'communities' | 'feed' | 'wallet';

interface BottomNavigationProps {
  readonly onChange: (route: MobileRoute) => void;
  readonly route: MobileRoute;
}

const items = [
  { label: 'Feed', route: 'feed' },
  { label: 'Communities', route: 'communities' },
  { label: 'Wallet', route: 'wallet' },
] as const;

export function BottomNavigation({ onChange, route }: BottomNavigationProps): React.JSX.Element {
  return (
    <View accessibilityRole="tablist" style={styles.container}>
      {items.map((item) => {
        const selected = route === item.route;
        return (
          <Pressable
            accessibilityLabel={`Open ${item.label}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={item.route}
            onPress={() => {
              onChange(item.route);
            }}
            style={[styles.item, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    bottom: 14,
    flexDirection: 'row',
    gap: 4,
    left: 20,
    padding: 5,
    position: 'absolute',
    right: 20,
  },
  item: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  label: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  selected: {
    backgroundColor: colors.accent,
  },
  selectedLabel: {
    color: colors.accentInk,
  },
});
