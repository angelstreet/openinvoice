import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useUser, useAuth } from '@clerk/clerk-react';
import { app as teamsApp } from '@microsoft/teams-js';
import { setTokenGetter } from '../lib/api';

interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  userName: string | null;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState>({
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  userName: null,
  getToken: async () => null,
});

export const useAppAuth = () => useContext(AuthContext);

// When Clerk IS available (wrapped inside ClerkProvider)
export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded: userLoaded, user } = useUser();
  const { isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (isSignedIn) {
      setTokenGetter(getToken);
    }
  }, [isSignedIn, getToken]);

  const state: AuthState = {
    isLoaded: userLoaded,
    isSignedIn: !!isSignedIn,
    userId: user?.id ?? null,
    userName: user?.fullName ?? null,
    getToken,
  };

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}

// When running inside Microsoft Teams iframe
export function TeamsAuthProvider({ team, children }: { team: string; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoaded: false,
    isSignedIn: false,
    userId: null,
    userName: null,
    getToken: async () => null,
  });
  const appTokenRef = useRef<string | null>(null);
  const expiryRef = useRef<number>(0);
  const refreshingRef = useRef<Promise<string | null> | null>(null);
  // Persist Teams context so we can refresh tokens without calling the Teams SDK again
  const teamsContextRef = useRef<{ user_id: string; display_name: string; upn: string; tenant_id: string } | null>(null);

  /** Save token + Teams context to sessionStorage */
  const saveCache = (token: string, expiry: number, userId: string, userName: string) => {
    sessionStorage.setItem('oi_teams_auth', JSON.stringify({
      token, expiry, userId, userName,
      // Persist Teams context for SDK-free refresh
      teamsContext: teamsContextRef.current,
    }));
  };

  /** Exchange Teams context for an app token */
  const exchangeToken = async (teamId: string): Promise<{ token: string; user_id: string; name: string }> => {
    const ctx = teamsContextRef.current;
    if (!ctx) throw new Error('No Teams context available');
    const res = await fetch('/api/auth/teams-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ctx, team: teamId }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    return res.json();
  };

  const buildTokenGetter = (teamId: string) => async (): Promise<string | null> => {
    if (Date.now() > expiryRef.current) {
      if (!refreshingRef.current) {
        refreshingRef.current = (async () => {
          try {
            const data = await exchangeToken(teamId);
            appTokenRef.current = data.token;
            expiryRef.current = Date.now() + 7.5 * 60 * 60 * 1000;
            saveCache(data.token, expiryRef.current, data.user_id, data.name);
            return data.token;
          } finally {
            refreshingRef.current = null;
          }
        })();
      }
      return refreshingRef.current;
    }
    return appTokenRef.current;
  };

  /** Restore auth from sessionStorage cache (token + Teams context) */
  const restoreFromCache = (cancelled: () => boolean): boolean => {
    const cached = sessionStorage.getItem('oi_teams_auth');
    if (!cached) return false;
    try {
      const parsed = JSON.parse(cached);
      if (parsed.expiry <= Date.now()) return false;

      appTokenRef.current = parsed.token;
      expiryRef.current = parsed.expiry;
      if (parsed.teamsContext) teamsContextRef.current = parsed.teamsContext;

      const tokenGetter = buildTokenGetter(team);
      setTokenGetter(tokenGetter);

      if (!cancelled()) {
        setState({
          isLoaded: true,
          isSignedIn: true,
          userId: parsed.userId,
          userName: parsed.userName,
          getToken: tokenGetter,
        });
      }
      return true;
    } catch { return false; }
  };

  /** Full Teams auth — calls SDK to get context, then exchanges for app token */
  const authenticateFromSdk = async (cancelled: () => boolean) => {
    await teamsApp.initialize();
    const context = await teamsApp.getContext();

    const userId = context.user?.id;
    if (!userId) throw new Error('No user ID in Teams context');

    // Save context so future refreshes don't need the SDK
    teamsContextRef.current = {
      user_id: userId,
      display_name: context.user?.displayName ?? '',
      upn: context.user?.userPrincipalName ?? '',
      tenant_id: context.user?.tenant?.id ?? '',
    };

    const data = await exchangeToken(team);

    appTokenRef.current = data.token;
    expiryRef.current = Date.now() + 7.5 * 60 * 60 * 1000;
    saveCache(data.token, expiryRef.current, data.user_id, data.name);

    const tokenGetter = buildTokenGetter(team);
    setTokenGetter(tokenGetter);

    if (!cancelled()) {
      setState({
        isLoaded: true,
        isSignedIn: true,
        userId: data.user_id,
        userName: data.name,
        getToken: tokenGetter,
      });
    }
  };

  /** Refresh using cached Teams context (no SDK needed) */
  const refreshFromContext = async (cancelled: () => boolean): Promise<boolean> => {
    if (!teamsContextRef.current) return false;
    try {
      const data = await exchangeToken(team);
      appTokenRef.current = data.token;
      expiryRef.current = Date.now() + 7.5 * 60 * 60 * 1000;
      saveCache(data.token, expiryRef.current, data.user_id, data.name);

      const tokenGetter = buildTokenGetter(team);
      setTokenGetter(tokenGetter);

      if (!cancelled()) {
        setState({
          isLoaded: true,
          isSignedIn: true,
          userId: data.user_id,
          userName: data.name,
          getToken: tokenGetter,
        });
      }
      return true;
    } catch { return false; }
  };

  // Initial auth on mount
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    (async () => {
      // 1. Try sessionStorage cache
      if (restoreFromCache(isCancelled)) return;
      // 2. Fall back to Teams SDK
      try {
        await authenticateFromSdk(isCancelled);
      } catch (err) {
        console.error('Teams auth failed:', err);
        if (!cancelled) {
          setState({ isLoaded: true, isSignedIn: false, userId: null, userName: null, getToken: async () => null });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [team]);

  // Re-authenticate when tab becomes visible (Teams idle can expire token / clear storage)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      // Token still valid in memory — nothing to do
      if (appTokenRef.current && Date.now() < expiryRef.current) return;

      const neverCancel = () => false;

      // 1. Try sessionStorage (Teams may have preserved it)
      if (restoreFromCache(neverCancel)) return;
      // 2. Try refreshing with cached Teams context (no SDK needed — avoids Ocdi error)
      refreshFromContext(neverCancel).then((ok) => {
        if (ok) return;
        // 3. Last resort — try SDK (may fail after idle, but worth trying)
        authenticateFromSdk(neverCancel).catch((err) => {
          console.error('Teams re-auth failed after idle:', err);
          setState({ isLoaded: true, isSignedIn: false, userId: null, userName: null, getToken: async () => null });
        });
      });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [team]);

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}

// When Clerk is NOT available
export function NoAuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        isLoaded: true,
        isSignedIn: false,
        userId: null,
        userName: null,
        getToken: async () => null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
