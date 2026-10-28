'use client';

import { useEffect, useState } from 'react';
import App from '../App';
import Login from '../Login';
import { getUserFromToken } from '../actions/auth';

export default function Page() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkToken = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }
      const data = await getUserFromToken(token);
      if (data) {
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
  
  if (!user) {
    return <Login />;
  }

  return <App initialUser={user} />;
}
