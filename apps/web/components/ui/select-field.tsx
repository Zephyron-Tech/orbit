'use client';

import { CaretDown, Check } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function SelectField({
  value,
  options,
  onValueChange,
  label,
  ariaLabel,
  helper,
  name,
  disabled = false,
  className = '',
  buttonClassName = '',
}: {
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  label?: string;
  ariaLabel?: string;
  helper?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
}): React.JSX.Element {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 320 });
  const foundIndex = options.findIndex((option) => option.value === value);
  const selectedIndex = foundIndex >= 0 ? foundIndex : 0;
  const selected = foundIndex >= 0 ? options[foundIndex] : undefined;

  function close(): void {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function choose(option: SelectOption): void {
    if (option.disabled) return;
    onValueChange(option.value);
    close();
  }

  const updatePosition = useCallback((): void => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
    const desiredHeight = Math.min(options.length * 48 + 16, 320);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const opensAbove = below < Math.min(desiredHeight, 180) && above > below;
    const menuHeight = Math.max(120, Math.min(desiredHeight, opensAbove ? above : below));
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
      top: opensAbove ? Math.max(8, rect.top - menuHeight - 6) : Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8),
      width: menuWidth,
      maxHeight: menuHeight,
    });
  }, [options.length]);

  function openMenu(): void {
    if (disabled || !buttonRef.current) return;
    updatePosition();
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      const path = event.composedPath();
      if (!path.includes(buttonRef.current as EventTarget) && !path.includes(menuRef.current as EventTarget)) {
        setOpen(false);
      }
    };
    let frame: number | null = null;
    const refreshPosition = (event?: Event): void => {
      const target = event?.target;
      // The portal itself is scrollable. Scrolling its options must not dismiss
      // or reposition it under the pointer.
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updatePosition();
      });
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', refreshPosition);
    window.addEventListener('scroll', refreshPosition, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', refreshPosition);
      window.removeEventListener('scroll', refreshPosition, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-option-${activeIndex}`)}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, id, open]);

  const control = (
    <div className={`min-w-0 ${className}`}>
      {label ? <label id={`${id}-label`} className="mb-1.5 block text-sm font-medium">{label}</label> : null}
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-describedby={open ? `${id}-active-option` : undefined}
        aria-labelledby={label ? `${id}-label ${id}-value` : undefined}
        aria-label={!label ? ariaLabel : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) openMenu();
            else setActiveIndex((index) => nextEnabledIndex(options, index, event.key === 'ArrowDown' ? 1 : -1));
          } else if (event.key === 'Home' && open) {
            event.preventDefault();
            setActiveIndex(nextEnabledIndex(options, -1, 1));
          } else if (event.key === 'End' && open) {
            event.preventDefault();
            setActiveIndex(nextEnabledIndex(options, options.length, -1));
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!open) openMenu();
            else if (options[activeIndex]) choose(options[activeIndex]);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
          } else if (event.key === 'Tab' && open) {
            setOpen(false);
          }
        }}
        className={`flex min-h-[2.625rem] w-full min-w-0 items-center justify-between gap-3 rounded-[0.625rem] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 py-2 text-left text-sm text-ink transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-45 ${buttonClassName}`}
      >
        <span id={`${id}-value`} className={`min-w-0 truncate font-medium ${selected ? '' : 'text-ink-muted'}`}>{selected?.label ?? 'Vyberte možnost'}</span>
        <CaretDown size={16} className={`shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? <span id={`${id}-active-option`} className="sr-only">{options[activeIndex]?.label ?? ''}</span> : null}
      {helper ? <p className="ui-helper mt-1.5">{helper}</p> : null}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              id={`${id}-listbox`}
              role="listbox"
              aria-labelledby={label ? `${id}-label` : undefined}
              tabIndex={-1}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') close();
              }}
              className="select-menu-scroll fixed z-[70] overflow-y-auto overscroll-contain rounded-xl border border-line-strong bg-[var(--surface-raised)] p-1.5 shadow-[0_18px_50px_rgb(8_15_25/22%)]"
              style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
            >
              {options.map((option, index) => (
                <button
                  key={`${option.value}-${option.label}`}
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={(event) => {
                    event.stopPropagation();
                    choose(option);
                  }}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    activeIndex === index ? 'bg-[var(--accent-soft)]' : 'hover:bg-surface-subtle'
                  } disabled:opacity-40`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">{option.label}</span>
                    {option.description ? <span className="mt-0.5 block text-xs text-ink-muted">{option.description}</span> : null}
                  </span>
                  {option.value === value ? <Check size={16} className="shrink-0 text-accent" weight="bold" aria-hidden="true" /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );

  return control;
}

function nextEnabledIndex(options: readonly SelectOption[], start: number, direction: 1 | -1): number {
  let index = start;
  for (let count = 0; count < options.length; count += 1) {
    index += direction;
    if (index < 0) index = options.length - 1;
    if (index >= options.length) index = 0;
    if (!options[index]?.disabled) return index;
  }
  return Math.max(0, Math.min(options.length - 1, start));
}
