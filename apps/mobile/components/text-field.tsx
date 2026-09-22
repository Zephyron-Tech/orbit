import { useState } from 'react';
import { TextInput, type KeyboardTypeOptions, type TextInputProps } from 'react-native';

export type TextFieldVariant = 'text' | 'money' | 'integer' | 'email';

const KEYBOARD_TYPE: Record<TextFieldVariant, KeyboardTypeOptions> = {
  text: 'default',
  money: 'decimal-pad',
  integer: 'number-pad',
  email: 'email-address',
};

/**
 * Drop-in replacement for RN's TextInput with the app's border/placeholder
 * tokens, a focus-state accent border, and a variant prop that standardizes
 * keyboard type (money fields all get decimal-pad, not the inconsistent
 * numbers-and-punctuation some screens used) and return-key defaults.
 */
export function TextField({
  variant = 'text',
  className,
  onFocus,
  onBlur,
  keyboardType,
  returnKeyType,
  autoCapitalize,
  ...rest
}: {
  variant?: TextFieldVariant;
} & TextInputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      className={`rounded-lg border px-4 py-3 text-base text-ink ${focused ? 'border-accent' : 'border-line'} ${className ?? ''}`}
      placeholderTextColor="#667570"
      keyboardType={keyboardType ?? KEYBOARD_TYPE[variant]}
      returnKeyType={returnKeyType ?? 'done'}
      autoCapitalize={autoCapitalize ?? (variant === 'email' ? 'none' : undefined)}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      {...rest}
    />
  );
}
