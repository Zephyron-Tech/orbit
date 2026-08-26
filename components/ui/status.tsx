import type { ReactNode } from 'react';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-surface text-ink',
  info: 'border-accent/25 bg-[var(--accent-soft)] text-ink',
  success: 'border-positive/25 bg-[var(--positive-soft)] text-ink',
  warning: 'border-warning/25 bg-[var(--warning-soft)] text-ink',
  danger: 'border-critical/25 bg-[var(--critical-soft)] text-ink',
};

export function StatusNotice({
  title,
  children,
  tone = 'neutral',
  actions,
  live,
}: {
  title?: string;
  children: ReactNode;
  tone?: Tone;
  actions?: ReactNode;
  live?: 'polite' | 'assertive';
}): React.JSX.Element {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 text-sm ${TONES[tone]}`}
      role={tone === 'danger' ? 'alert' : undefined}
      aria-live={live}
    >
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={`${title ? 'mt-1 ' : ''}text-sm leading-relaxed text-ink-muted`}>{children}</div>
      </div>
      {actions ? <div className="flex max-w-full flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
