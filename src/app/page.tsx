'use client';

import { useEffect, useState } from 'react';
import App from '../App';
import Login from '../Login';
import { getUserFromToken } from '../actions/auth';
import { deviceHints } from '../lib/deviceHints';

export default function Page() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const checkToken = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }
      const data = await getUserFromToken(token, await deviceHints());
      if (data && 'rateLimited' in data) {
        setBusy(true); // too many checks from this network: keep the token, ask to reload later
      } else if (data) {
        setUser(data);
      } else {
        localStorage.removeItem('token');
      }
      setLoading(false);
    };
    checkToken();
  }, []);

  if (loading) {
    return <div style={{ background: '#17191d', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#fff' }}>Loading...</div>;
  }
  
  if (busy) {
    return <div style={{ background: '#17191d', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#fff' }}>Too many requests from your network. Please wait a minute and reload the page.</div>;
  }

  if (!user) {
    return <Login />;
  }

  return <App initialUser={user} />;
}
