import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginScreen() {
  const { login, busy, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || busy) return;
    void login(email, password);
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit} data-testid="login-form">
        <div className="auth-mark">
          <span />
          <span />
          <span />
        </div>
        <span className="eyebrow">ORBITAL - IT OPERATIONS</span>
        <h1>Control room sign in</h1>
        <p className="auth-hint">
          Enter your email and password, then confirm the 6-digit TOTP code to
          unlock the control tower.
        </p>
        <div className="auth-field">
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.local"
            data-testid="input-auth-email"
          />
        </div>
        <div className="auth-field">
          <Label htmlFor="auth-password">Password</Label>
          <Input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            data-testid="input-auth-password"
          />
        </div>
        {error && (
          <div className="auth-error" role="alert" data-testid="auth-error">
            {error}
          </div>
        )}
        <Button
          type="submit"
          className="button button-primary auth-submit"
          disabled={busy || !email || !password}
          data-testid="button-auth-login"
        >
          {busy ? 'Signing in...' : 'Sign in'}
          <ShieldCheck size={15} />
        </Button>
        <p className="auth-footer">
          Multi-factor authentication protects this control room.
        </p>
      </form>
    </div>
  );
}