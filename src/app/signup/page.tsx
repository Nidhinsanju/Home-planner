'use client';

import { useEffect, useState } from 'react';
import Signup from '../../Signup';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      router.push('/');
    } else {
      setLoading(false);
    }
  }, [router]);

  if (loading) return <div style={{ background: '#17191d', height: '100vh' }}></div>;
  
  return <Signup />;
}
