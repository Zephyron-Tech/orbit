'use client';

import { SelectField } from '@/components/ui/select-field';
import { formatPeriod, isPeriod, storePeriod } from '@/lib/ui/period';

export function MonthSelect({
  value,
  months,
  onValueChange,
  includeAll = false,
  allLabel = 'Všechny měsíce',
  label,
  ariaLabel = 'Měsíc',
  disabled,
  className,
}: {
  value: string;
  months: string[];
  onValueChange: (value: string) => void;
  includeAll?: boolean;
  allLabel?: string;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  const validMonths = months.filter(isPeriod);
  const options = [...new Set([...(isPeriod(value) ? [value] : []), ...validMonths])]
    .sort()
    .reverse()
    .map((month) => ({ value: month, label: formatPeriod(month) }));

  if (includeAll) options.unshift({ value: '', label: allLabel });

  return (
    <SelectField
      value={value}
      options={options}
      label={label}
      ariaLabel={ariaLabel}
      disabled={disabled}
      className={className}
      onValueChange={(next) => {
        if (next) storePeriod(next);
        onValueChange(next);
      }}
    />
  );
}
