import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type AuthUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

export type AuthSession = {
  access_token: string;
  refresh_token?: string;
  user?: AuthUser | null;
};

export type AuthFactor = {
  id: string;
  factor_type: string;
  status: string;
};

export type AuthStatus = 'restoring' | 'signedOut' | 'needsTotp' | 'signedIn';

type LoginResponse = {
  ok: boolean;
  message?: string;
  access_token?: string;
  refresh_token?: string;
  user?: AuthUser | null;
  weak_session?: boolean;
  factors?: AuthFactor[];
};

type VerifyResponse = {
  ok: boolean;
  message?: string;
  accessToken?: string;
  refreshToken?: string;
  challengeId?: string;
};

type UserResponse = {
  ok: boolean;
  user?: AuthUser | null;
  message?: string;
};

const STORAGE_KEY = 'orbital.auth.session';

export type AuthMode = 'full' | 'demo';

// AUTH_MODE=demo (backend `GET /api/auth/mode`) bypasses the 2FA gate for
// prototyping/UI demos. This session only marks the app as "signed in" client-side.
const DEMO_SESSION: AuthSession = {
  access_token: 'demo',
  refresh_token: 'demo',
  user: { id: 'demo-operator', email: 'demo@orbit.local' },
};

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  email: string;
  error: string | null;
  busy: boolean;
  login: (email: string, password: string) => Promise<void>;
  verifyTotp: (code: string) => Promise<void>;
  cancelTotp: () => void;
  logout: () => Promise<void>;
  clearError: () => void;
};

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return (await res.json()) as T;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { signal: AbortSignal.timeout(15000) });
  return (await res.json()) as T;
}

type PendingTotp = {
  email: string;
  accessToken: string;
  refreshToken?: string;
  factors: AuthFactor[];
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<PendingTotp | null>(null);
  const demoRef = useRef(false);

  // Restore a stored session on boot; validate it against the API server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let mode: AuthMode = 'full';
      try {
        const m = await getJSON<{ mode?: AuthMode }>('/api/auth/mode');
        if (m.mode === 'demo') mode = 'demo';
      } catch {
        // API unreachable; fall back to full auth and let validation surface it.
      }
      if (cancelled) return;
      if (mode === 'demo') {
        demoRef.current = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_SESSION));
        setSession(DEMO_SESSION);
        setEmail(DEMO_SESSION.user?.email ?? '');
        setStatus('signedIn');
        return;
      }
      demoRef.current = false;
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        raw = null;
      }
      if (!raw) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      try {
        const stored = JSON.parse(raw) as AuthSession;
        const res = await postJSON<UserResponse>('/api/auth/user', {
          access_token: stored.access_token,
        });
        if (cancelled) return;
        if (res.ok) {
          setSession({
            access_token: stored.access_token,
            refresh_token: stored.refresh_token,
            user: res.user ?? null,
          });
          setEmail(res.user?.email ?? '');
          setStatus('signedIn');
        } else {
          localStorage.removeItem(STORAGE_KEY);
          setStatus('signedOut');
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        if (!cancelled) setStatus('signedOut');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (em: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      if (demoRef.current) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_SESSION));
        setSession(DEMO_SESSION);
        setEmail(DEMO_SESSION.user?.email ?? '');
        setStatus('signedIn');
        return;
      }
      const res = await postJSON<LoginResponse>('/api/auth/login', {
        email: em,
        password,
      });
      if (!res.ok || !res.access_token) {
        throw new Error(res.message ?? 'Sign in failed');
      }
      if (res.weak_session) {
        pendingRef.current = {
          email: em,
          accessToken: res.access_token,
          refreshToken: res.refresh_token,
          factors: res.factors ?? [],
        };
        setEmail(em);
        setStatus('needsTotp');
      } else {
        const sess: AuthSession = {
          access_token: res.access_token,
          refresh_token: res.refresh_token,
          user: res.user ?? null,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
        setSession(sess);
        setEmail(em);
        setStatus('signedIn');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
      setStatus('signedOut');
    } finally {
      setBusy(false);
    }
  }, []);

  const verifyTotp = useCallback(async (code: string) => {
    if (demoRef.current) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_SESSION));
      setSession(DEMO_SESSION);
      setStatus('signedIn');
      return;
    }
    const pending = pendingRef.current;
    if (!pending) {
      setError('Session expired; sign in again');
      setStatus('signedOut');
      return;
    }
    const factor =
      pending.factors.find((f) => f.factor_type === 'totp') ??
      pending.factors[0];
    if (!factor) {
      setError('No TOTP factor found on this account');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await postJSON<VerifyResponse>('/api/auth/totp/verify', {
        factor_id: factor.id,
        code,
        access_token: pending.accessToken,
      });
      if (!res.ok) {
        throw new Error(res.message ?? 'Code invalid');
      }
      const token = res.accessToken ?? pending.accessToken;
      const userRes = await postJSON<UserResponse>('/api/auth/user', {
        access_token: token,
      });
      const sess: AuthSession = {
        access_token: token,
        refresh_token: res.refreshToken ?? pending.refreshToken,
        user: userRes.ok ? userRes.user ?? null : null,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
      setSession(sess);
      setStatus('signedIn');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const cancelTotp = useCallback(() => {
    pendingRef.current = null;
    setError(null);
    setStatus('signedOut');
  }, []);

  const logout = useCallback(async () => {
    const token = session?.access_token;
    setBusy(true);
    try {
      if (token) {
        await postJSON<{ ok: boolean }>('/api/auth/logout', {
          access_token: token,
        }).catch(() => null);
      }
    } finally {
      localStorage.removeItem(STORAGE_KEY);
      pendingRef.current = null;
      setSession(null);
      setEmail('');
      setError(null);
      setStatus('signedOut');
      setBusy(false);
    }
  }, [session]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      email,
      error,
      busy,
      login,
      verifyTotp,
      cancelTotp,
      logout,
      clearError,
    }),
    [status, session, email, error, busy, login, verifyTotp, cancelTotp, logout, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}