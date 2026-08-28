import { getSupabaseConfig, isSupabaseConfigured } from "./supabase";
import { readEnv } from "./config";

type SupabaseAuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user?: { id: string; email?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> };
};

export type LoginResult = {
  ok: boolean;
  status?: number;
  message: string;
  session?: SupabaseAuthSession;
};

export type TotpEnrollment = {
  ok: boolean;
  factorId?: string;
  qrCode?: string;
  verificationUri?: string;
  secret?: string;
  message: string;
};

function baseUrl() {
  return (readEnv("SUPABASE_URL") || "").replace(/\/$/, "");
}

function headers(json = true) {
  const { anonKey } = getSupabaseConfig();
  const h: Record<string, string> = {
    apikey: anonKey as string,
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/** POST /auth/v1/token?grant_type=password — email + password sign in.
 *  Returns a session; if the account has TOTP enabled, the session's
 *  `user.app_metadata` reflects 2FA state and the UI proceeds to verify.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Supabase not configured" };
  }
  try {
    const res = await fetch(`${baseUrl()}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: (body as { error_description?: string; msg?: string })[
          "error_description"
        ] || (body as { msg?: string }).msg || "Sign in failed",
      };
    }
    return { ok: true, status: res.status, message: "Signed in", session: body as SupabaseAuthSession };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Network error during sign in",
    };
  }
}

/** GET /auth/v1/user — load current user from an access token. */
export async function getUser(accessToken: string): Promise<{ ok: boolean; user?: unknown; message?: string }> {
  try {
    const res = await fetch(`${baseUrl()}/auth/v1/user`, {
      headers: { ...headers(false), Authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json();
    if (!res.ok) {
      return { ok: false, message: (body as { msg?: string }).msg || "Failed to load user" };
    }
    return { ok: true, user: body };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

/** POST /auth/v1/factors — start TOTP enrollment (needs access token). */
export async function enrollTotp(
  accessToken: string,
  friendlyName = "2FA",
): Promise<TotpEnrollment> {
  try {
    const res = await fetch(`${baseUrl()}/auth/v1/factors`, {
      method: "POST",
      headers: { ...headers(), Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ friendly_name: friendlyName, factor_type: "totp" }),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        message: (body.msg as string) || (body.error_description as string) || "Enrollment failed",
      };
    }
    const factor = body as {
      id: string;
      totp?: { qr_code?: string; secret?: string; uri?: string };
    };
    return {
      ok: true,
      factorId: factor.id,
      qrCode: factor.totp?.qr_code,
      secret: factor.totp?.secret,
      verificationUri: factor.totp?.uri,
      message: "TOTP enrolled - scan the QR code to continue",
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

/** POST /auth/v1/factors/{id}/verify — confirm a TOTP code to finalize the factor. */
export async function verifyTotp(
  factorId: string,
  code: string,
  accessToken: string,
): Promise<{ ok: boolean; challengeId?: string; message: string }> {
  try {
    // 1) create a challenge
    const chal = await fetch(`${baseUrl()}/auth/v1/factors/${factorId}/challenge`, {
      method: "POST",
      headers: { ...headers(), Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    });
    const chalBody = await chal.json() as { id?: string; msg?: string };
    if (!chal.ok) {
      return { ok: false, message: chalBody.msg || "Could not create challenge" };
    }
    // 2) verify
    const res = await fetch(`${baseUrl()}/auth/v1/factors/${factorId}/verify`, {
      method: "POST",
      headers: { ...headers(), Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ challenge_id: chalBody.id, code }),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        message: (body.msg as string) || "TOTP code invalid",
      };
    }
    return { ok: true, challengeId: (body as { id?: string }).id, message: "TOTP verified" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

/** POST /auth/v1/logout — revoke a session. */
export async function signOut(accessToken: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${baseUrl()}/auth/v1/logout`, {
      method: "POST",
      headers: { ...headers(false), Authorization: `Bearer ${accessToken}` },
    });
    return res.ok
      ? { ok: true, message: "Signed out" }
      : { ok: false, message: "Sign out failed" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}
