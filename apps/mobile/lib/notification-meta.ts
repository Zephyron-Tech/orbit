import {
  BankIcon,
  BellIcon,
  CarIcon,
  ChartLineUpIcon,
  ClockCounterClockwiseIcon,
  CreditCardIcon,
  GasPumpIcon,
  HandshakeIcon,
  LinkBreakIcon,
  PiggyBankIcon,
  ReceiptIcon,
  TagIcon,
  TrendUpIcon,
  WarningCircleIcon,
  type Icon,
} from 'phosphor-react-native';

import { colors } from './colors';

export type NotificationTone = 'accent' | 'warning' | 'danger' | 'positive';

export const TONE_STYLES: Record<NotificationTone, { bg: string; fg: string }> = {
  accent: { bg: 'bg-accent-soft', fg: colors.accent },
  warning: { bg: 'bg-warning-soft', fg: colors.warning },
  danger: { bg: 'bg-critical-soft', fg: colors.critical },
  positive: { bg: 'bg-positive-soft', fg: colors.positive },
};

// One entry per NotificationType (apps/api's enum) — icon, tone, and where
// "Otevřít" on the detail screen should take the user. Reuses the same icon
// vocabulary as dashboard.tsx's ACTION_ICONS / net-worth.tsx's TYPE_ICON
// rather than inventing a second one.
export const NOTIFICATION_META: Record<string, { icon: Icon; tone: NotificationTone; href: string }> = {
  INSURANCE_RENEWAL: { icon: CarIcon, tone: 'warning', href: '/(tabs)/more/insurance' },
  PORTFOLIO_DIGEST: { icon: ChartLineUpIcon, tone: 'accent', href: '/(tabs)/portfolio' },
  DCA_OVERDUE: { icon: ClockCounterClockwiseIcon, tone: 'warning', href: '/(tabs)/more/planning' },
  RECURRING_EXPENSE_OVERDUE: { icon: ReceiptIcon, tone: 'warning', href: '/(tabs)/more/planning' },
  UNMATCHED_TRANSFER_STUCK: { icon: LinkBreakIcon, tone: 'warning', href: '/(tabs)/net-worth' },
  STATEMENT_COVERAGE_GAP: { icon: BankIcon, tone: 'warning', href: '/(tabs)/net-worth' },
  FAILED_IMPORT_ROW: { icon: WarningCircleIcon, tone: 'danger', href: '/(tabs)/more/import' },
  SETTLEMENT_NOT_CLOSED: { icon: HandshakeIcon, tone: 'warning', href: '/(tabs)/more/settlement' },
  DIVIDEND_RECEIVED: { icon: TrendUpIcon, tone: 'positive', href: '/(tabs)/portfolio' },
  UNCATEGORIZED_PILEUP: { icon: TagIcon, tone: 'warning', href: '/(tabs)/more/transactions' },
  BIG_PORTFOLIO_MOVE: { icon: ChartLineUpIcon, tone: 'accent', href: '/(tabs)/portfolio' },
  CASH_BUFFER_LOW: { icon: PiggyBankIcon, tone: 'danger', href: '/(tabs)/net-worth' },
  CREDIT_UTILIZATION_HIGH: { icon: CreditCardIcon, tone: 'danger', href: '/(tabs)/more/accounts' },
  FUEL_RECEIPT_MISSING: { icon: GasPumpIcon, tone: 'warning', href: '/(tabs)/fuel' },
};

export const DEFAULT_NOTIFICATION_META: { icon: Icon; tone: NotificationTone; href: string | null } = { icon: BellIcon, tone: 'accent', href: null };

export function notificationMeta(type: string): { icon: Icon; tone: NotificationTone; href: string | null } {
  return NOTIFICATION_META[type] ?? DEFAULT_NOTIFICATION_META;
}

function pluralizeDays(count: number): string {
  if (count === 1) return '1 den';
  if (count >= 2 && count <= 4) return `${count} dny`;
  return `${count} dní`;
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'právě teď';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return pluralizeDays(days);
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
