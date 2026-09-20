import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="surface flex flex-col items-start gap-3 p-6 md:p-8">
      {icon ? <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-accent">{icon}</div> : null}
      <div>
        <h2 className="font-semibold tracking-[-0.015em]">{title}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
