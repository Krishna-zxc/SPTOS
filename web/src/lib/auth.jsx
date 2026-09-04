/** Session state: who is signed in, and what that lets them see (FR-S5). */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ROLE_HOME } from '@sptos/shared';
import api, { getToken, onUnauthorized, setToken } from './api.js';
import { refreshSocketAuth } from './socket.js';

const USER_KEY = 'sptos.user';
const AuthContext = createContext(null);

/** The cached user, so a reload renders the right shell before /me answers. */
function readCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readCachedUser);
  const [ready, setReady] = useState(!getToken());

  const persist = useCallback((nextUser) => {
    setUser(nextUser);
    if (nextUser) localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    else localStorage.removeItem(USER_KEY);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    persist(null);
    // The socket authenticated as this user and joined their private room; it
    // has to stop being them too.
    refreshSocketAuth();
  }, [persist]);

  // A token in localStorage is a claim, not proof: confirm it against /me on
  // boot so a revoked or expired session does not linger in the UI.
  useEffect(() => {
    if (!getToken()) {
      persist(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    api
      .get('/api/auth/me')
      .then((data) => {
        if (!cancelled) persist(data.user);
      })
      .catch((err) => {
        // Offline: keep the cached identity so the app still opens. Any other
        // failure means the token is genuinely no good.
        if (!cancelled && !err.offline) signOut();
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [persist, signOut]);

  useEffect(() => onUnauthorized(() => persist(null)), [persist]);

  const value = useMemo(() => {
    const accept = ({ token, user: nextUser }) => {
      setToken(token);
      persist(nextUser);
      refreshSocketAuth();
      return nextUser;
    };

    return {
      user,
      ready,
      role: user?.role ?? null,
      isAdmin: user?.role === 'admin',
      isDriver: user?.role === 'driver' || user?.role === 'admin',
      home: ROLE_HOME[user?.role] ?? '/',
      signIn: async (email, password) =>
        accept(await api.post('/api/auth/login', { email, password })),
      register: async (input) => accept(await api.post('/api/auth/register', input)),
      signOut,
      refresh: async () => persist((await api.get('/api/auth/me')).user),
    };
  }, [user, ready, persist, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
