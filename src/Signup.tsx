'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signup } from './actions/auth';
import { addDeviceHints } from './lib/deviceHints';
import './index.css';

export default function Signup() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    if (form.get('password') !== form.get('confirmPassword')) {
      setError('Passwords do not match');
      return;
    }

    setPending(true);
    try {
      const res = await signup(await addDeviceHints(form));

      if (res.error) {
        setError(res.error);
      } else if (res.token) {
        localStorage.setItem('token', res.token);
        // The spinner stays on until the app's page replaces this one.
        router.replace('/');
        return;
      }
    } catch {
      setError('Something went wrong. Please try again.');
    }
    setPending(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: '600px' }}>
        <div className="auth-header">
          <h2>Sign Up</h2>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <fieldset disabled={pending}>
            <div className="grid-2-col">
              <div className="input-group">
                <label>Name</label>
                <input type="text" name="name" required placeholder="Enter your name" />
              </div>

              <div className="input-group">
                <label>Email</label>
                <input type="email" name="email" required placeholder="Enter your email" />
              </div>

              <div className="input-group">
                <label>Create Password</label>
                <input type="password" name="password" required minLength={8} maxLength={128} placeholder="Create password (8+ characters)" />
              </div>

              <div className="input-group">
                <label>Confirm Password</label>
                <input type="password" name="confirmPassword" required minLength={8} maxLength={128} placeholder="Confirm password" />
              </div>
            </div>

            <button type="submit" className="auth-btn">
              {pending ? <><span className="auth-spinner" /> Creating account…</> : 'Sign Up'}
            </button>
          </fieldset>
        </form>

        <div className="auth-footer">
          Already have an account? <Link href="/">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
