import { Switch as RNSwitch, type SwitchProps } from 'react-native';

import { haptics } from '../lib/haptics';

/**
 * Drop-in replacement for RN's Switch with the app's accent track color set
 * for both states (most call sites only set `true`, leaving the untracked
 * state at the OS default) plus a haptic tick on toggle.
 */
export function Switch({ onValueChange, ...rest }: SwitchProps): React.JSX.Element {
  return (
    <RNSwitch
      trackColor={{ false: '#d8e0dd', true: '#17647c' }}
      thumbColor="#ffffff"
      ios_backgroundColor="#d8e0dd"
      onValueChange={(value) => {
        haptics.toggle();
        onValueChange?.(value);
      }}
      {...rest}
    />
  );
}
