import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_TOKEN_KEY = 'orbit_refresh_token';

/**
 * `expo-secure-store` has no web implementation (it wraps iOS Keychain /
 * Android Keystore, neither of which exist in a browser) — it throws at
 * runtime on the web target. `localStorage` is not a secure equivalent and
 * is only used here so the Expo web target (used for dev/CI verification
 * without a simulator, per Phase 3's scope) can exercise the same login
 * flow; a real device build always uses SecureStore.
 */
const webStore = {
  getItemAsync: async (key: string) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  setItemAsync: async (key: string, value: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
  deleteItemAsync: async (key: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

// Exported so lib/biometric-auth.ts can persist its own preference key
// through the same web-fallback-aware storage instead of duplicating it.
export const store = Platform.OS === 'web' ? webStore : SecureStore;

/**
 * Access token lives in memory only — it's short-lived (15 min) and never
 * worth persisting; the refresh token (long-lived, 30 days) is the only
 * thing that needs to survive an app restart, so it's the only thing in
 * `expo-secure-store` (Keychain/Keystore-backed).
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export async function getRefreshToken(): Promise<string | null> {
  return store.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function setRefreshToken(token: string): Promise<void> {
  await store.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  await store.deleteItemAsync(REFRESH_TOKEN_KEY);
}
