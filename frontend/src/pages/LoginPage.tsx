import React, { useState } from 'react';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import logo from '../assets/logo.png';
import { setStoredAuth } from '../auth/authContext';
import './LoginPage.css';

// No props needed — login writes to sessionStorage then does a full-page reload,
// which re-mounts the entire app into the authenticated render tree.
const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please enter your username and password.');
      return;
    }

    setLoading(true);
    // Simulate auth — replace with real API call
    setTimeout(() => {
      setStoredAuth({ username: username.trim() });
      // Full-page reload: tears down pre-auth render tree, remounts authenticated app
      window.location.reload();
    }, 800);
  };

  return (
    <div className="login-root">
      <div className="login-bg-pattern" />

      <div className="login-card">
        {/* Logo */}
        <div className="login-logo-wrap">
          <img src={logo} alt="NTT DATA Logo" className="login-logo" />
        </div>

        <div className="login-header">
          <h1 className="login-title">Welcome to AI Sphere</h1>
          <p className="login-subtitle">Sign in to access your AI Innovation Hub</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="username" className="login-label">Username</label>
            <input
              id="username"
              type="text"
              className="login-input"
              placeholder="Enter your username"
              value={username}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="login-field">
            <label htmlFor="password" className="login-label">Password</label>
            <div className="login-password-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (
              <span className="login-spinner" />
            ) : (
              <>
                <LogIn size={18} />
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>

        <p className="login-footer">
          © {new Date().getFullYear()} NTT DATA. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
