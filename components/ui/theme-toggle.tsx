'use client';

import { Moon, Sun } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

const EVENT = 'orbit-theme-change';

function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function subscribe(callback: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== 'orbit-theme') return;
    document.documentElement.dataset.theme = event.newValue === 'dark' ? 'dark' : 'light';
    callback();
  };
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function ThemeToggle({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'light');
  const next = theme === 'light' ? 'dark' : 'light';

  function toggle(): void {
    document.documentElement.dataset.theme = next;
    localStorage.setItem('orbit-theme', next);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`ui-button ui-button-ghost ${compact ? 'h-9 flex-1 justify-center p-0' : 'w-full justify-start'}`}
      aria-label={next === 'dark' ? 'Přepnout na tmavý režim' : 'Přepnout na světlý režim'}
      title={next === 'dark' ? 'Tmavý režim' : 'Světlý režim'}
    >
      {theme === 'light' ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
      {compact ? null : <span>{theme === 'light' ? 'Tmavý režim' : 'Světlý režim'}</span>}
    </button>
  );
}
