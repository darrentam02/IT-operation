import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';

export function TotpScreen() {
  const { email, verifyTotp, cancelTotp, busy, error } = useAuth();
  const [code, setCode] = useState('');

  const submit = () => {
    if (code.length === 6 && !busy) void verifyTotp(code);
  };

  return (
    <div className="auth-shell">
      <div className="auth-card" data-testid="totp-form">
        <div className="auth-mark">
          <span />
          <span />
          <span />
        </div>
        <span className="eyebrow">TWO-FACTOR AUTHENTICATION</span>
        <h1>Enter your code</h1>
        <p className="auth-hint">
          Open your authenticator app and enter the 6-digit code for{' '}
          <b>{email || 'your account'}</b>.
        </p>
        <div className="otp-wrap">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            onComplete={submit}
            data-testid="input-totp"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        {error && (
          <div className="auth-error" role="alert" data-testid="auth-error">
            {error}
          </div>
        )}
        <button
          className="button button-primary auth-submit"
          onClick={submit}
          disabled={busy || code.length < 6}
          data-testid="button-totp-verify"
        >
          {busy ? 'Verifying...' : 'Verify & unlock'}
        </button>
        <button
          className="auth-back"
          onClick={cancelTotp}
          disabled={busy}
          data-testid="button-totp-back"
        >
          Use a different account
        </button>
      </div>
    </div>
  );
}