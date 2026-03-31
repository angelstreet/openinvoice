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

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Initialize Teams SDK
        await teamsApp.initialize();
        const context = await teamsApp.getContext();

        const userId = context.user?.id;
        if (!userId) throw new Error('No user ID in Teams context');

        const displayName = context.user?.displayName ?? '';
        const upn = context.user?.userPrincipalName ?? '';
        const tenantId = context.user?.tenant?.id ?? '';

        // Exchange context for app token
        const res = await fetch('/api/auth/teams-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            display_name: displayName,
            upn: upn,
            tenant_id: tenantId,
            team,
          }),
        });

        if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
        const data = await res.json();

        appTokenRef.current = data.token;
        expiryRef.current = Date.now() + 55 * 60 * 1000; // refresh 5 min before 1h expiry

        const tokenGetter = async (): Promise<string | null> => {
          // Lazy refresh with deduplication
          if (Date.now() > expiryRef.current) {
            if (!refreshingRef.current) {
              refreshingRef.current = (async () => {
                try {
                  const ctx = await teamsApp.getContext();
                  const refreshRes = await fetch('/api/auth/teams-context', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      user_id: ctx.user?.id,
                      display_name: ctx.user?.displayName ?? '',
                      upn: ctx.user?.userPrincipalName ?? '',
                      tenant_id: ctx.user?.tenant?.id ?? '',
                      team,
                    }),
                  });
                  const refreshData = await refreshRes.json();
                  appTokenRef.current = refreshData.token;
                  expiryRef.current = Date.now() + 55 * 60 * 1000;
                  return refreshData.token;
                } finally {
                  refreshingRef.current = null;
                }
              })();
            }
            return refreshingRef.current;
          }
          return appTokenRef.current;
        };

        setTokenGetter(tokenGetter);

        if (!cancelled) {
          setState({
            isLoaded: true,
            isSignedIn: true,
            userId: data.user_id,
            userName: data.name,
            getToken: tokenGetter,
          });
        }
      } catch (err) {
        console.error('Teams auth failed:', err);
        if (!cancelled) {
          setState({
            isLoaded: true,
            isSignedIn: false,
            userId: null,
            userName: null,
            getToken: async () => null,
          });
        }
      }
    }

    init();
    return () => { cancelled = true; };
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
