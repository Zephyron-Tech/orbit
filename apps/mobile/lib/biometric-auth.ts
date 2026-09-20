import * as LocalAuthentication from 'expo-local-authentication';

import { store } from './auth-storage';

const BIOMETRIC_LOCK_PREFERENCE_KEY = 'orbit_biometric_lock_enabled';

/** Whether this device has usable Face ID / Touch ID (hardware present AND at least one face/fingerprint enrolled). */
export async function isBiometricAuthAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  return LocalAuthentication.isEnrolledAsync();
}

/** Persisted opt-in — defaults to off so a fresh install always shows the normal password login once. */
export async function isBiometricLockEnabled(): Promise<boolean> {
  const value = await store.getItemAsync(BIOMETRIC_LOCK_PREFERENCE_KEY);
  return value === 'true';
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await store.setItemAsync(BIOMETRIC_LOCK_PREFERENCE_KEY, 'true');
  } else {
    await store.deleteItemAsync(BIOMETRIC_LOCK_PREFERENCE_KEY);
  }
}

export interface BiometricPromptResult {
  ok: boolean;
  error?: string;
}

/** Prompts Face ID / Touch ID. `error` is only set on a genuine failure, never on a user-initiated cancel. */
export async function promptBiometricUnlock(): Promise<BiometricPromptResult> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Odemkněte Orbit',
    cancelLabel: 'Zrušit',
    disableDeviceFallback: false,
  });

  if (result.success) return { ok: true };
  if (result.error === 'user_cancel' || result.error === 'system_cancel') return { ok: false };
  return { ok: false, error: 'Ověření se nezdařilo' };
}
