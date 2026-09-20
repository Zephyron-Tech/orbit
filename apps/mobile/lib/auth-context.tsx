import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { apiClient, login as apiLogin, logout as apiLogout, tryRefresh, UnauthorizedError } from './api-client';
import { setAccessToken } from './auth-storage';
import { isBiometricAuthAvailable, isBiometricLockEnabled, promptBiometricUnlock } from './biometric-auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface AuthContextValue {
  /** `null` while the cold-start check is still in flight. */
  isAuthenticated: boolean | null;
  /**
   * A stored session exists but the biometric gate hasn't been passed yet —
   * the app must render the unlock screen instead of either the tabs or the
   * password login form. Always `false` once `isAuthenticated` is non-null.
   */
  locked: boolean;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Resolves the deferred silent-refresh + session fetch after a successful Face ID / Touch ID prompt. */
  unlockWithBiometrics: () => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSession(): Promise<SessionUser | null> {
  const response = await apiClient.auth.session.$get();
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) return null;
  const body = await response.json();
  return body.user;
}

/** The part shared by a fresh password login and a completed biometric unlock. */
async function completeSignIn(setUser: (u: SessionUser | null) => void, setIsAuthenticated: (v: boolean) => void): Promise<void> {
  try {
    const sessionUser = await fetchSession();
    setUser(sessionUser);
    setIsAuthenticated(sessionUser !== null);
  } catch {
    setIsAuthenticated(false);
  }
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      // A refresh token existing is the only signal a previous login might
      // still be valid — checked before deciding whether to show the
      // biometric gate at all (no point locking an app nobody's logged into).
      const accessToken = await tryRefresh();
      if (cancelled) return;

      if (!accessToken) {
        setIsAuthenticated(false);
        return;
      }

      const [available, enabled] = await Promise.all([isBiometricAuthAvailable(), isBiometricLockEnabled()]);
      if (cancelled) return;

      if (available && enabled) {
        // Stop here — completeSignIn runs later, from unlockWithBiometrics,
        // once the user actually passes the prompt. isAuthenticated stays
        // null so index.tsx keeps showing the loading spinner for an
        // instant, then locked flips it to the unlock screen.
        setLocked(true);
        return;
      }

      await completeSignIn(setUser, setIsAuthenticated);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    if (!result.ok) return result;

    await completeSignIn(setUser, setIsAuthenticated);
    return result;
  }, []);

  const unlockWithBiometrics = useCallback(async () => {
    const result = await promptBiometricUnlock();
    if (!result.ok) return result;

    await completeSignIn(setUser, setIsAuthenticated);
    setLocked(false);
    return result;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setAccessToken(null);
    setUser(null);
    setIsAuthenticated(false);
    setLocked(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated, locked, user, login, unlockWithBiometrics, logout }),
    [isAuthenticated, locked, user, login, unlockWithBiometrics, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
