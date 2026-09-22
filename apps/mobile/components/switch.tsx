import { Switch as RNSwitch, type SwitchProps } from 'react-native';

import { colors } from '../lib/colors';
import { haptics } from '../lib/haptics';

/**
 * Drop-in replacement for RN's Switch with the app's accent track color set
 * for both states (most call sites only set `true`, leaving the untracked
 * state at the OS default) plus a haptic tick on toggle.
 */
export function Switch({ onValueChange, value, ...rest }: SwitchProps): React.JSX.Element {
  return (
    <RNSwitch
      trackColor={{ false: colors.line, true: colors.accent }}
      thumbColor="#ffffff"
      ios_backgroundColor={colors.line}
      value={value}
      accessibilityRole="switch"
      accessibilityState={{ checked: value ?? false }}
      onValueChange={(newValue) => {
        haptics.toggle();
        onValueChange?.(newValue);
      }}
      {...rest}
    />
  );
}
