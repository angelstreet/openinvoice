import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useUser, useAuth } from '@clerk/clerk-react';
import { setTokenGetter } from '../lib/api';

interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState>({
  isLoaded: true,
  isSignedIn: false,
  userId: null,
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
    getToken,
  };

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
        getToken: async () => null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
