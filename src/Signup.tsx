'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signup } from './actions/auth';
import './index.css';

export default function Signup() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    
    if (formData.get('password') !== formData.get('confirmPassword')) {
      setError('Passwords do not match');
      return;
    }
    
    const res = await signup(formData);
    
    if (res.error) {
      setError(res.error);
    } else if (res.token) {
      localStorage.setItem('token', res.token);
      window.location.href = '/';
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: '600px' }}>
        <div className="auth-header">
          <h2>Sign Up</h2>
        </div>
        
        {error && <div className="login-error">{error}</div>}
        
        <form className="auth-form" onSubmit={handleSubmit}>
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
              <input type="password" name="password" required placeholder="Create password" />
            </div>

            <div className="input-group">
              <label>Confirm Password</label>
              <input type="password" name="confirmPassword" required placeholder="Confirm password" />
            </div>
          </div>
          
          <button type="submit" className="auth-btn">
            Sign Up
          </button>
        </form>
        
        <div className="auth-footer">
          Already have an account? <a href="/">Sign In</a>
        </div>
      </div>
    </div>
  );
}
