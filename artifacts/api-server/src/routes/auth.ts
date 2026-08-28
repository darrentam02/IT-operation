import { Router, type IRouter } from "express";
import {
  signInWithPassword,
  getUser,
  verifyTotp,
  signOut,
} from "../integrations/supabase-auth";

const router: IRouter = Router();

// POST /api/auth/login — email + password; returns session (step 1 of 2FA)
router.post("/auth/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    res.status(400).json({ ok: false, message: "Email and password are required" });
    return;
  }
  const result = await signInWithPassword(email, password);
  if (!result.ok) {
    res.status(result.status && result.status < 500 ? result.status : 401).json({ ok: false, message: result.message });
    return;
  }
  res.json({
    ok: true,
    access_token: result.session?.access_token,
    refresh_token: result.session?.refresh_token,
    user: result.session?.user,
  });
});

// POST /api/auth/user — load the current user for the token
router.post("/auth/user", async (req, res) => {
  const token = typeof req.body?.access_token === "string" ? req.body.access_token : "";
  if (!token) {
    res.status(400).json({ ok: false, message: "access_token required" });
    return;
  }
  const result = await getUser(token);
  if (!result.ok) {
    res.status(401).json(result);
    return;
  }
  res.json({ ok: true, user: result.user });
});

// POST /api/auth/totp/verify — complete 2FA with a TOTP code
router.post("/auth/totp/verify", async (req, res) => {
  const factorId = typeof req.body?.factor_id === "string" ? req.body.factor_id : "";
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  const token = typeof req.body?.access_token === "string" ? req.body.access_token : "";
  if (!factorId || !code || !token) {
    res.status(400).json({ ok: false, message: "factor_id, code and access_token required" });
    return;
  }
  const result = await verifyTotp(factorId, code, token);
  res.status(result.ok ? 200 : 401).json(result);
});

// POST /api/auth/logout
router.post("/auth/logout", async (req, res) => {
  const token = typeof req.body?.access_token === "string" ? req.body.access_token : "";
  if (!token) {
    res.status(400).json({ ok: false, message: "access_token required" });
    return;
  }
  const result = await signOut(token);
  res.status(result.ok ? 200 : 500).json(result);
});

export default router;
