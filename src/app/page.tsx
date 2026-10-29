'use client';

import { useCallback, useEffect, useState } from 'react';
import App from '../App';
import Login from '../Login';
import AuthLoader from '../AuthLoader';
import { getUserFromToken } from '../actions/auth';
import { deviceHints } from '../lib/deviceHints';

export default function Page() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Loads the user for the saved token. Returns false when there is no valid token.
  const loadUser = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return false;
    const data = await getUserFromToken(token, await deviceHints());
    if (data && 'rateLimited' in data) {
      setBusy(true); // too many checks from this network: keep the token, ask to reload later
      return true;
    }
    if (data) {
      setUser(data);
      return true;
    }
    localStorage.removeItem('token');
    return false;
  }, []);

  useEffect(() => {
    loadUser().catch(() => false).finally(() => setLoading(false));
  }, [loadUser]);

  if (loading) {
    return <AuthLoader />;
  }

  if (busy) {
    return <AuthLoader message="Too many requests from your network. Please wait a minute and reload the page." />;
  }

  if (!user) {
    return <Login onSignedIn={loadUser} />;
  }

  return <App initialUser={user} />;
}
