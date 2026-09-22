import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CalendarBlankIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

function parseDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Native iOS date picker (spinner/wheel via the system sheet) in place of a
 * free-text "RRRR-MM-DD" TextInput — value/onChange stay plain YYYY-MM-DD
 * strings so call sites (and the API) don't change.
 */
export function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);

  function handleChange(event: DateTimePickerEvent, selected?: Date): void {
    // Android fires 'dismissed' with no date on cancel; iOS's inline picker
    // has no separate cancel, every change is a real pick.
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'dismissed' || !selected) return;
    onChange(toDateOnlyString(selected));
  }

  return (
    <View>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        className={`flex-row items-center gap-2 rounded-lg border px-3 py-2 active:bg-surface-subtle ${open ? 'border-accent' : 'border-line'}`}
      >
        <CalendarBlankIcon color="#5d6c68" size={16} weight="regular" />
        <Text className="text-ink">{value || 'Vybrat datum'}</Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={parseDateOnly(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handleChange}
        />
      ) : null}
    </View>
  );
}
