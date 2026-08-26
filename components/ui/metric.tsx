import type { ReactNode } from 'react';

export function Metric({
  label,
  value,
  detail,
  tone = 'default',
  featured = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'default' | 'positive' | 'critical';
  featured?: boolean;
}): React.JSX.Element {
  const toneClass = tone === 'positive' ? 'text-positive' : tone === 'critical' ? 'text-critical' : 'text-ink';

  return (
    <div className={`surface min-w-0 ${featured ? 'p-6 md:p-7' : 'p-4'}`}>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={`money-value mt-1 font-semibold tracking-[-0.035em] ${featured ? 'text-[clamp(1.75rem,7vw,2.5rem)]' : 'text-[clamp(1.1rem,4.5vw,1.25rem)]'} ${toneClass}`}>
        {value}
      </p>
      {detail ? <div className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</div> : null}
    </div>
  );
}
