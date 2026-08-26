'use client';

import {
  Bank,
  CarIcon as Car,
  DownloadSimple,
  Handshake,
  List,
  PlanetIcon as Planet,
  Receipt,
  SignOut,
  SquaresFour,
  Target,
  TrendUp,
  UsersThree,
  Wallet,
  X,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { signOut } from 'next-auth/react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { isPeriod, PERIOD_EVENT } from '@/lib/ui/period';

interface NavItem {
  href: string;
  label: string;
  shortLabel?: string;
  icon: Icon;
}

const PRIMARY: NavItem[] = [
  { href: '/dashboard', label: 'Přehled', icon: SquaresFour },
  { href: '/transactions', label: 'Transakce', shortLabel: 'Transakce', icon: Receipt },
  { href: '/net-worth', label: 'Čisté jmění', shortLabel: 'Jmění', icon: Wallet },
  { href: '/portfolio', label: 'Portfolio', icon: TrendUp },
  { href: '/settlement', label: 'Vyrovnání', icon: Handshake },
  { href: '/import', label: 'Import', icon: DownloadSimple },
];

const SETTINGS: NavItem[] = [
  { href: '/settings/accounts', label: 'Účty', icon: Bank },
  { href: '/settings/planning', label: 'Plánování', icon: Target },
  { href: '/settings/insurance', label: 'Pojistky', icon: Car },
  { href: '/settings/users', label: 'Domácnost', icon: UsersThree },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, preferredPeriod, onNavigate }: { item: NavItem; preferredPeriod: string | null; onNavigate?: () => void }): React.JSX.Element {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const IconComponent = item.icon;
  const href = withPreferredPeriod(item.href, preferredPeriod);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
        active ? 'bg-[var(--accent-soft)] text-accent' : 'text-ink-muted hover:bg-surface-subtle hover:text-ink'
      }`}
    >
      <IconComponent size={19} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

function withPreferredPeriod(href: string, period: string | null): string {
  if (!period) return href;
  if (href === '/dashboard' || href === '/settlement') return `${href}?period=${period}`;
  if (href === '/transactions') return `${href}?month=${period}`;
  return href;
}

function Navigation({ preferredPeriod, onNavigate }: { preferredPeriod: string | null; onNavigate?: () => void }): React.JSX.Element {
  return (
    <nav aria-label="Hlavní navigace" className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-1">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} item={item} preferredPeriod={preferredPeriod} onNavigate={onNavigate} />
        ))}
      </div>
      <div>
        <p className="mb-2 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-faint">Nastavení</p>
        <div className="flex flex-col gap-1">
          {SETTINGS.map((item) => (
            <NavLink key={item.href} item={item} preferredPeriod={preferredPeriod} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    </nav>
  );
}

export function AppShell({ children, userLabel, preferredPeriod }: { children: ReactNode; userLabel: string; preferredPeriod: string | null }): React.JSX.Element {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePeriod, setActivePeriod] = useState(preferredPeriod);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  useEffect(() => {
    const update = (event: Event): void => {
      const value = event instanceof CustomEvent ? event.detail : null;
      if (isPeriod(value)) setActivePeriod(value);
    };
    window.addEventListener(PERIOD_EVENT, update);
    return () => window.removeEventListener(PERIOD_EVENT, update);
  }, []);

  useEffect(() => {
    async function verifyAccess(): Promise<void> {
      try {
        const response = await fetch('/api/session/status', { cache: 'no-store' });
        const payload: unknown = await response.json().catch(() => null);
        const active = typeof payload === 'object' && payload !== null && 'active' in payload && payload.active === true;
        if (!active) await signOut({ callbackUrl: '/signin' });
      } catch {
        // Temporary network errors must not sign a user out.
      }
    }

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void verifyAccess();
    };
    void verifyAccess();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[var(--accent-foreground)] focus:translate-y-0"
      >
        Přeskočit na obsah
      </a>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <Link href="/dashboard" className="mb-7 flex items-center gap-3 px-2 py-1" aria-label="Orbit, přehled">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-[var(--accent-foreground)]">
            <Planet size={21} weight="fill" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.04em]">Orbit</span>
        </Link>
        <Navigation preferredPeriod={activePeriod} />
        <div className="mt-4 border-t border-line pt-4">
          <p className="truncate px-3 text-xs text-ink-muted" title={userLabel}>{userLabel}</p>
          <div className="mt-1">
            <ThemeToggle />
          </div>
          <button
            type="button"
            onClick={() => setSignOutConfirmOpen(true)}
            className="mt-2 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-ink-muted hover:bg-surface-subtle hover:text-ink"
          >
            <SignOut size={18} aria-hidden="true" />
            Odhlásit se
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-[-0.03em]">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-[var(--accent-foreground)]">
            <Planet size={19} weight="fill" aria-hidden="true" />
          </span>
          Orbit
        </Link>
        <button
          type="button"
          aria-label={menuOpen ? 'Zavřít navigaci' : 'Otevřít navigaci'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="ui-button ui-button-ghost size-11 p-0"
        >
          {menuOpen ? <X size={22} /> : <List size={22} />}
        </button>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-20 overflow-y-auto bg-canvas px-4 pb-8 pt-20 lg:hidden">
          <Navigation preferredPeriod={activePeriod} onNavigate={() => setMenuOpen(false)} />
          <div className="mt-5 border-t border-line pt-4">
            <p className="px-3 text-xs text-ink-muted">{userLabel}</p>
            <div className="mt-2">
              <ThemeToggle />
            </div>
            <button
              type="button"
              onClick={() => setSignOutConfirmOpen(true)}
              className="mt-2 flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-ink-muted hover:bg-surface-subtle"
            >
              <SignOut size={18} /> Odhlásit se
            </button>
          </div>
        </div>
      ) : null}

      <div id="main-content" className="lg:pl-64" key={pathname}>
        {children}
      </div>

      <nav
        aria-label="Rychlá navigace"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-surface/95 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur md:hidden"
      >
        {PRIMARY.slice(0, 5).map((item) => {
          const IconComponent = item.icon;
          const active = isActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={withPreferredPeriod(item.href, activePeriod)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-center text-[0.625rem] font-medium leading-tight ${
                active ? 'text-accent' : 'text-ink-muted'
              }`}
            >
              <IconComponent size={20} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
              <span className="max-w-full truncate">{item.shortLabel ?? item.label}</span>
            </Link>
          );
        })}
      </nav>

      <ConfirmDialog
        open={signOutConfirmOpen}
        title="Odhlásit se?"
        description="Opravdu se chcete odhlásit?"
        confirmLabel="Odhlásit se"
        onCancel={() => setSignOutConfirmOpen(false)}
        onConfirm={() => void signOut({ callbackUrl: '/signin' })}
      />
    </div>
  );
}
