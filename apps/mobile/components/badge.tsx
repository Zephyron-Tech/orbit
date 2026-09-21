import { Text, View } from 'react-native';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

// Matches apps/web/components/ui/status.tsx's Badge tone palette.
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface',
  info: 'border-accent/25 bg-accent-soft',
  success: 'border-positive/25 bg-positive-soft',
  warning: 'border-warning/25 bg-warning-soft',
  danger: 'border-critical/25 bg-critical-soft',
};

export function Badge({ children, tone = 'neutral' }: { children: string | number; tone?: BadgeTone }): React.JSX.Element {
  return (
    <View className={`rounded-full border px-2 py-1 ${TONE_CLASSES[tone]}`}>
      <Text className="font-sans-medium text-xs text-ink">{children}</Text>
    </View>
  );
}
