'use client';

import type { ReactNode } from 'react';

import { usePrivacyMode } from '@/lib/ui/privacy-mode';

const MASK = '••••••';

export function MoneyValue({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  const hidden = usePrivacyMode();

  if (hidden) {
    return (
      <span className={className} aria-label="Částka skryta">
        {MASK}
      </span>
    );
  }

  return <span className={className}>{children}</span>;
}
