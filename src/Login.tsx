'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from './actions/auth';
import { addDeviceHints } from './lib/deviceHints';

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = await addDeviceHints(new FormData(e.currentTarget));
    
    const res = await login(formData);
    
    if (res.error) {
      setError(res.error);
    } else if (res.token) {
      localStorage.setItem('token', res.token);
      window.location.href = '/'; 
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>Sign In</h2>
        </div>
        
        {error && <div className="login-error">{error}</div>}
        
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Email Address</label>
            <input type="email" name="email" required placeholder="Enter your email" />
          </div>
          
          <div className="input-group">
            <label>Password</label>
            <input type="password" name="password" required placeholder="Enter your password" />
          </div>
          
          <button type="submit" className="auth-btn">
            Sign In
          </button>
        </form>
        
        <div className="auth-footer">
          Don't have an account? <a href="/signup">Sign Up</a>
        </div>
      </div>
    </div>
  );
}
