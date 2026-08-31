'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react';

import { togglePrivacyMode, usePrivacyMode } from '@/lib/ui/privacy-mode';

export function PrivacyToggle({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const hidden = usePrivacyMode();

  return (
    <button
      type="button"
      onClick={togglePrivacyMode}
      className={`ui-button ui-button-ghost ${compact ? 'h-9 flex-1 justify-center p-0' : 'w-full justify-start'}`}
      aria-label={hidden ? 'Zobrazit částky' : 'Skrýt částky'}
      title={hidden ? 'Zobrazit částky' : 'Skrýt částky'}
    >
      {hidden ? <EyeSlash size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      {compact ? null : <span>{hidden ? 'Zobrazit částky' : 'Skrýt částky'}</span>}
    </button>
  );
}
