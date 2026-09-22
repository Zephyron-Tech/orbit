import type { Icon } from 'phosphor-react-native';
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';

import { colors } from '../lib/colors';
import { haptics } from '../lib/haptics';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'default' | 'chip';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const CONTAINER_CLASSES: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: {
    default: 'items-center justify-center rounded-lg bg-accent py-3 active:bg-accent-hover',
    chip: 'flex-row items-center justify-center gap-1 rounded-md bg-accent px-2 py-1 active:bg-accent-hover',
  },
  secondary: {
    default: 'items-center justify-center rounded-lg border border-line py-3 active:bg-surface-subtle',
    chip: 'flex-row items-center justify-center gap-1 rounded-md border border-line px-2 py-1 active:bg-surface-subtle',
  },
  destructive: {
    default: 'items-center justify-center rounded-lg border border-critical/25 py-3 active:bg-critical-soft',
    chip: 'flex-row items-center justify-center gap-1 rounded-md bg-critical-soft px-2 py-1 active:opacity-70',
  },
  ghost: {
    default: 'items-center justify-center py-2 active:opacity-70',
    chip: 'flex-row items-center justify-center gap-1 px-2 py-1 active:opacity-70',
  },
};

const TEXT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'font-sans-medium text-accent-foreground',
  secondary: 'font-sans-medium text-ink',
  destructive: 'font-sans-medium text-critical',
  ghost: 'font-sans-medium text-ink-muted',
};

const SPINNER_COLOR: Record<ButtonVariant, string> = {
  primary: colors.accentForeground,
  secondary: colors.ink,
  destructive: colors.critical,
  ghost: colors.inkMuted,
};

const ICON_COLOR: Record<ButtonVariant, string> = SPINNER_COLOR;

export function Button({
  variant = 'primary',
  size = 'default',
  loading = false,
  disabled,
  icon: IconComponent,
  children,
  className,
  onPress,
  haptic = true,
  accessibilityLabel,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: Icon;
  children: string;
  className?: string;
  haptic?: boolean;
} & Omit<PressableProps, 'children' | 'className'>): React.JSX.Element {
  const textSizeClass = size === 'chip' ? 'text-xs' : '';
  const iconSize = size === 'chip' ? 13 : 16;

  return (
    <Pressable
      hitSlop={HIT_SLOP}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={(event) => {
        if (haptic) (variant === 'destructive' ? haptics.tapMedium : haptics.tapLight)();
        onPress?.(event);
      }}
      className={`${CONTAINER_CLASSES[variant][size]} ${disabled ? 'opacity-50' : ''} ${className ?? ''}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={SPINNER_COLOR[variant]} />
      ) : (
        <>
          {IconComponent ? <IconComponent color={ICON_COLOR[variant]} size={iconSize} weight={variant === 'primary' ? 'bold' : 'regular'} /> : null}
          <Text className={`${TEXT_CLASSES[variant]} ${textSizeClass}`}>{children}</Text>
        </>
      )}
    </Pressable>
  );
}
