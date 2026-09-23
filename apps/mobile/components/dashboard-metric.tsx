import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * Mirrors apps/web/app/(dashboard)/dashboard/page.tsx's local
 * `DashboardMetric` component — icon square, label, big value, optional
 * progress bar (flat or gradient), optional detail line. Kept as a shared
 * mobile component since several dashboard cards and the burn-rate card
 * share this exact shape.
 */
export function DashboardMetric({
  icon,
  label,
  value,
  valueCaption,
  detail,
  detailTone,
  progress,
  progressColor,
  progressGradient,
  href,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  valueCaption?: ReactNode;
  detail: ReactNode;
  detailTone?: 'warning' | 'positive' | 'critical';
  progress?: number | null;
  /** Tailwind bg-* class for the filled portion of a flat progress bar. Ignored when `progressGradient` is set. */
  progressColor?: string;
  /** Credit-utilization-style gradient (positive→warning→critical) instead of a flat fill. */
  progressGradient?: boolean;
  href?: string;
}): React.JSX.Element {
  const visibleProgress = progress === null || progress === undefined ? null : Math.max(0, Math.min(progress, 100));
  const detailClassName = detailTone === 'warning' ? 'text-warning' : detailTone === 'positive' ? 'text-positive' : detailTone === 'critical' ? 'text-critical' : 'text-ink-muted';

  const content = (
    <>
      <View className="flex-row items-start justify-between gap-3">
        <Text className="font-sans-medium flex-1 text-sm text-ink-muted">{label}</Text>
        <View className="size-8 items-center justify-center rounded-lg bg-accent-soft">{icon}</View>
      </View>
      <Text className="font-sans-semibold mt-4 text-2xl text-ink">{value}</Text>
      {valueCaption ? <Text className="mt-1 text-xs text-ink-muted">{valueCaption}</Text> : null}
      {visibleProgress !== null ? (
        progressGradient ? (
          <View className="mt-4 h-1.5 overflow-hidden rounded-full bg-positive">
            <View className="absolute inset-y-0 right-0 bg-line" style={{ width: `${100 - visibleProgress}%` }} />
          </View>
        ) : (
          <View className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
            <View className={`h-full rounded-full ${progressColor ?? 'bg-accent'}`} style={{ width: `${visibleProgress}%` }} />
          </View>
        )
      ) : null}
      <Text className={`mt-3 text-xs leading-relaxed ${detailClassName}`}>{detail}</Text>
    </>
  );

  if (href) {
    return (
      <Link href={href as never} asChild>
        <Pressable className="rounded-lg border border-line bg-surface p-4 active:bg-surface-subtle">{content}</Pressable>
      </Link>
    );
  }

  return <View className="rounded-lg border border-line bg-surface p-4">{content}</View>;
}
