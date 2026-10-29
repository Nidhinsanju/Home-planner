'use client';

import { useEffect, useState } from 'react';
import Signup from '../../Signup';
import AuthLoader from '../../AuthLoader';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      router.replace('/');
    } else {
      setLoading(false);
    }
  }, [router]);

  if (loading) return <AuthLoader />;

  return <Signup />;
}
