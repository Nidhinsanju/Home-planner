'use client';

import { useState } from 'react';
import Link from 'next/link';
import { login } from './actions/auth';
import { addDeviceHints } from './lib/deviceHints';

// `onSignedIn` loads the signed-in user (see app/page.tsx) and returns false if that failed.
export default function Login({ onSignedIn }: { onSignedIn: () => Promise<boolean> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const formData = await addDeviceHints(new FormData(e.currentTarget));
      const res = await login(formData);

      if (res.error) {
        setError(res.error);
      } else if (res.token) {
        localStorage.setItem('token', res.token);
        // The spinner stays on until the app replaces this screen.
        if (await onSignedIn()) return;
        setError('Could not sign in. Please try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    }
    setPending(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>Sign In</h2>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <fieldset disabled={pending}>
            <div className="input-group">
              <label>Email Address</label>
              <input type="email" name="email" required placeholder="Enter your email" />
            </div>

            <div className="input-group">
              <label>Password</label>
              <input type="password" name="password" required placeholder="Enter your password" />
            </div>

            <button type="submit" className="auth-btn">
              {pending ? <><span className="auth-spinner" /> Signing in…</> : 'Sign In'}
            </button>
          </fieldset>
        </form>

        <div className="auth-footer">
          Don't have an account? <Link href="/signup">Sign Up</Link>
        </div>
      </div>
    </div>
  );
}
