import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as client from '../lib/api.js';

const AuthContext = createContext(null);

/**
 * Session lifecycle: on load, try to restore the session from the httpOnly refresh cookie.
 * `status` is 'loading' until that resolves, then 'authenticated' or 'guest'.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    let active = true;
    client
      .refreshSession()
      .then((data) => active && setState({ status: 'authenticated', user: data.user }))
      .catch(() => active && setState({ status: 'guest', user: null }));
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      client.onSessionExpired(() => {
        queryClient.clear();
        setState({ status: 'guest', user: null });
      }),
    [queryClient],
  );

  const signIn = useCallback(async (credentials) => {
    const user = await client.login(credentials);
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  const signUp = useCallback(async (details) => {
    const user = await client.register(details);
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await client.logout();
    } finally {
      queryClient.clear();
      setState({ status: 'guest', user: null });
    }
  }, [queryClient]);

  /** Used after flows that end every session server-side (e.g. "sign out everywhere"). */
  const forgetSession = useCallback(() => {
    client.setAccessToken(null);
    queryClient.clear();
    setState({ status: 'guest', user: null });
  }, [queryClient]);

  const updateUser = useCallback((user) => setState((s) => ({ ...s, user })), []);

  const value = useMemo(
    () => ({ ...state, signIn, signUp, signOut, forgetSession, updateUser }),
    [state, signIn, signUp, signOut, forgetSession, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
