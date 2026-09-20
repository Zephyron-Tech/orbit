import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { apiClient, login as apiLogin, logout as apiLogout, tryRefresh, UnauthorizedError } from './api-client';
import { setAccessToken } from './auth-storage';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface AuthContextValue {
  /** `null` while the cold-start silent-refresh check is still in flight. */
  isAuthenticated: boolean | null;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
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

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      // The in-memory access token is always null right after launch — a
      // silent refresh (backed by the persisted refresh token) is the only
      // way to know whether a previous login is still valid, before making
      // any authenticated call at all.
      const accessToken = await tryRefresh();
      if (cancelled) return;

      if (!accessToken) {
        setIsAuthenticated(false);
        return;
      }

      try {
        const sessionUser = await fetchSession();
        if (cancelled) return;
        setUser(sessionUser);
        setIsAuthenticated(sessionUser !== null);
      } catch {
        if (!cancelled) setIsAuthenticated(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    if (!result.ok) return result;

    try {
      const sessionUser = await fetchSession();
      setUser(sessionUser);
      setIsAuthenticated(sessionUser !== null);
    } catch {
      setIsAuthenticated(false);
    }

    return result;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setAccessToken(null);
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ isAuthenticated, user, login, logout }), [isAuthenticated, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
