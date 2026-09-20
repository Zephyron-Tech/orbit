import Constants from 'expo-constants';
import { hc } from 'hono/client';
import { Platform } from 'react-native';
import type { AppType } from '@orbit/api-types';

import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from './auth-storage';

/**
 * Resolves the API's base URL for dev.
 *
 * `EXPO_PUBLIC_API_URL` (inlined at bundle time, Expo's client-visible-env
 * convention — see https://docs.expo.dev/guides/environment-variables/)
 * wins when set, matching production. Otherwise, `localhost` only reaches
 * a Mac's dev server from the web target and the iOS Simulator — a physical
 * device or the Android emulator needs the dev machine's LAN IP, which
 * Expo already knows (`hostUri`, the same host the app was bundled from).
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];

  if (host && Platform.OS === 'android' && host === 'localhost') {
    // The Android emulator's own loopback maps the host machine to 10.0.2.2.
    return 'http://10.0.2.2:4000';
  }
  if (host) return `http://${host}:4000`;

  return 'http://localhost:4000';
}

const API_URL = resolveApiUrl();

async function authorizedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('X-Client', 'mobile');
  const access = getAccessToken();
  if (access) headers.set('Authorization', `Bearer ${access}`);

  const response = await fetch(input, { ...init, headers });

  // /auth/* routes 401 on genuinely bad credentials too — retrying those
  // would just loop, so only retry a request that HAD a token and got
  // rejected (an expired access token), never a bare login attempt.
  if (response.status !== 401 || !access) return response;

  const refreshed = await tryRefresh();
  if (!refreshed) return response;

  headers.set('Authorization', `Bearer ${refreshed}`);
  return fetch(input, { ...init, headers });
}

let refreshInFlight: Promise<string | null> | null = null;

/** Rotates the refresh token and stores the new pair. Coalesces concurrent callers into one request. */
async function tryRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        await clearTokens();
        return null;
      }

      const body = (await response.json()) as { accessToken: string; refreshToken: string };
      setAccessToken(body.accessToken);
      await setRefreshToken(body.refreshToken);
      return body.accessToken;
    } catch {
      return null;
    }
  })();

  const result = await refreshInFlight;
  refreshInFlight = null;
  return result;
}

export const apiClient = hc<AppType>(API_URL, { fetch: authorizedFetch });

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? 'Přihlášení se nezdařilo' };
  }

  const body = (await response.json()) as { accessToken: string; refreshToken: string };
  setAccessToken(body.accessToken);
  await setRefreshToken(body.refreshToken);
  return { ok: true };
}

export async function logout(): Promise<void> {
  await clearTokens();
}
