'use client';

import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * A styled replacement for `<input type="date">`, matching select-field.tsx's
 * conventions (portal-positioned popup, hand-rolled — no calendar library in
 * this project). Value is always a plain "YYYY-MM-DD" string or "" (unset),
 * same as the native date input every call site already binds to — swapping
 * the two shouldn't need caller-side state changes.
 *
 * All calendar math uses Date.UTC/getUTC* — never the local-timezone Date
 * constructor — so a "YYYY-MM-DD" string round-trips exactly regardless of
 * the browser's timezone, the same discipline lib/parsers/csv/dates.ts uses
 * for stored transaction dates.
 */

const WEEKDAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const MONTH_LABELS = [
  'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
  'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec',
];

function parseDateValue(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) return null;

  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

function formatDateValue(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function formatDisplay(value: string): string {
  const parsed = parseDateValue(value);

  return parsed ? `${parsed.day.toString().padStart(2, '0')}.${(parsed.month + 1).toString().padStart(2, '0')}.${parsed.year}` : '';
}

function todayValue(): string {
  const now = new Date();

  return formatDateValue(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Every cell of a Monday-start calendar grid for the given month, including the leading/trailing days of neighboring months. */
function buildGrid(year: number, month: number): { year: number; month: number; day: number; inMonth: boolean }[] {
  const firstOfMonth = Date.UTC(year, month, 1);
  const firstWeekday = (new Date(firstOfMonth).getUTCDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: { year: number; month: number; day: number; inMonth: boolean }[] = [];

  for (let i = 0; i < firstWeekday; i++) {
    const day = daysInPrevMonth - firstWeekday + 1 + i;
    const date = new Date(Date.UTC(year, month - 1, day));
    cells.push({ year: date.getUTCFullYear(), month: date.getUTCMonth(), day, inMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ year, month, day, inMonth: true });
  }

  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = cells[cells.length - 1];
    if (!last) break;
    const date = new Date(Date.UTC(last.year, last.month, last.day + 1));
    cells.push({ year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), inMonth: false });
    if (cells.length >= 42) break;
  }

  return cells;
}

export function DateField({
  value,
  onValueChange,
  label,
  ariaLabel,
  helper,
  name,
  disabled = false,
  required = false,
  className = '',
}: {
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  ariaLabel?: string;
  helper?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}): React.JSX.Element {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 280 });
  const selected = parseDateValue(value);
  const [viewYear, setViewYear] = useState(() => selected?.year ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => selected?.month ?? new Date().getMonth());
  const [activeDay, setActiveDay] = useState(() => selected?.day ?? new Date().getDate());

  function close(): void {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  const updatePosition = useCallback((): void => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const panelWidth = Math.min(288, window.innerWidth - 16);
    const panelHeight = 340;
    const below = window.innerHeight - rect.bottom - 8;
    const opensAbove = below < panelHeight && rect.top - 8 > below;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8)),
      top: opensAbove ? Math.max(8, rect.top - panelHeight - 6) : rect.bottom + 6,
      width: panelWidth,
    });
  }, []);

  function openPanel(): void {
    if (disabled || !buttonRef.current) return;
    const base = selected ?? { year: new Date().getFullYear(), month: new Date().getMonth(), day: new Date().getDate() };
    setViewYear(base.year);
    setViewMonth(base.month);
    setActiveDay(base.day);
    updatePosition();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      const path = event.composedPath();
      if (!path.includes(buttonRef.current as EventTarget) && !path.includes(panelRef.current as EventTarget)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  function choose(year: number, month: number, day: number): void {
    onValueChange(formatDateValue(year, month, day));
    close();
  }

  function shiftMonth(delta: number): void {
    const date = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(date.getUTCFullYear());
    setViewMonth(date.getUTCMonth());
  }

  const grid = buildGrid(viewYear, viewMonth);

  return (
    <div className={`min-w-0 ${className}`}>
      {label ? <label id={`${id}-label`} className="mb-1.5 block text-sm font-medium">{label}</label> : null}
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={label ? `${id}-label ${id}-value` : undefined}
        aria-label={!label ? ariaLabel : undefined}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={(event) => {
          if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !open) {
            event.preventDefault();
            openPanel();
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
          }
        }}
        className="flex min-h-[2.625rem] w-full min-w-0 items-center justify-between gap-3 rounded-[0.625rem] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 py-2 text-left text-sm text-ink transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span id={`${id}-value`} className={`min-w-0 truncate font-medium ${selected ? '' : 'text-ink-muted'}`}>
          {selected ? formatDisplay(value) : 'Vyberte datum'}
        </span>
        <CalendarBlank size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
      </button>
      {helper ? <p className="ui-helper mt-1.5">{helper}</p> : null}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={label ? `${id}-label` : undefined}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  close();
                  return;
                }
                const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                const delta = deltas[event.key];
                if (delta !== undefined) {
                  event.preventDefault();
                  const date = new Date(Date.UTC(viewYear, viewMonth, activeDay + delta));
                  setViewYear(date.getUTCFullYear());
                  setViewMonth(date.getUTCMonth());
                  setActiveDay(date.getUTCDate());
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  choose(viewYear, viewMonth, activeDay);
                }
              }}
              className="fixed z-[70] rounded-xl border border-line-strong bg-[var(--surface-raised)] p-3 shadow-[0_18px_50px_rgb(8_15_25/22%)]"
              style={{ left: position.left, top: position.top, width: position.width }}
            >
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label="Předchozí měsíc" className="ui-button ui-button-secondary min-h-8 min-w-8 p-0">
                  <CaretLeft size={14} aria-hidden="true" />
                </button>
                <span className="text-sm font-semibold">{MONTH_LABELS[viewMonth]} {viewYear}</span>
                <button type="button" onClick={() => shiftMonth(1)} aria-label="Následující měsíc" className="ui-button ui-button-secondary min-h-8 min-w-8 p-0">
                  <CaretRight size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-ink-muted">
                {WEEKDAY_LABELS.map((weekday) => (
                  <span key={weekday} className="py-1">{weekday}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {grid.map((cell) => {
                  const cellValue = formatDateValue(cell.year, cell.month, cell.day);
                  const isSelected = cellValue === value;
                  const isToday = cellValue === todayValue();
                  const isActive = cell.inMonth && cell.year === viewYear && cell.month === viewMonth && cell.day === activeDay;

                  return (
                    <button
                      key={`${cell.year}-${cell.month}-${cell.day}`}
                      type="button"
                      onClick={() => choose(cell.year, cell.month, cell.day)}
                      onPointerEnter={() => cell.inMonth && setActiveDay(cell.day)}
                      className={`flex h-9 w-full items-center justify-center rounded-lg text-sm transition-colors ${
                        !cell.inMonth ? 'text-ink-faint' : 'text-ink'
                      } ${isSelected ? 'bg-accent text-white' : isActive ? 'bg-[var(--accent-soft)]' : 'hover:bg-surface-subtle'} ${
                        isToday && !isSelected ? 'font-semibold text-accent' : ''
                      }`}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
                <button type="button" onClick={() => { onValueChange(''); close(); }} className="font-medium text-accent hover:underline">
                  Vymazat
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = parseDateValue(todayValue());
                    if (today) choose(today.year, today.month, today.day);
                  }}
                  className="font-medium text-accent hover:underline"
                >
                  Dnes
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
