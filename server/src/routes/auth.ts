import { Router } from "express";
import { kite, storeSession, hasActiveSession, logout } from "../kite/kiteClient";
import { startTicker, subscribeTokens } from "../kite/ticker";
import { getAllTrackedInstrumentTokens } from "../db/db";
import { config } from "../config";
import { autoLogin } from "../kite/autoLogin";

export const authRouter = Router();

authRouter.get("/login", (_req, res) => {
  res.redirect(kite.getLoginURL());
});

authRouter.post("/auto-login", async (_req, res) => {
  const ok = await autoLogin();
  res.json({ ok });
});

authRouter.post("/logout", async (_req, res) => {
  await logout();
  res.json({ ok: true });
});

authRouter.get("/callback", async (req, res) => {
  const requestToken = req.query.request_token as string | undefined;
  if (!requestToken) {
    res.status(400).send("Missing request_token from Kite redirect");
    return;
  }

  try {
    const session = await kite.generateSession(requestToken, config.kiteApiSecret);
    storeSession(session.access_token, session.public_token);
    startTicker(session.access_token);
    subscribeTokens(getAllTrackedInstrumentTokens());
    res.redirect(`${config.clientUrl}?login=success`);
  } catch (err: any) {
    console.error("[auth] callback failed", err);
    res.redirect(`${config.clientUrl}?login=failed&reason=${encodeURIComponent(err.message ?? "unknown")}`);
  }
});

authRouter.get("/status", async (_req, res) => {
  if (!hasActiveSession()) {
    res.json({ loggedIn: false });
    return;
  }

  // A row existing in kite_sessions only means we once had a token — it may have expired
  // since. A cheap live call confirms it's still actually accepted by Kite; a TokenException
  // here trips the session expiry hook, which clears the stored token for next time.
  try {
    await kite.getProfile();
    res.json({ loggedIn: true });
  } catch {
    res.json({ loggedIn: false });
  }
});

authRouter.get("/profile", async (_req, res) => {
  if (!hasActiveSession()) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  try {
    const profile = await kite.getProfile();
    res.json({
      user_id: profile.user_id,
      user_name: profile.user_name,
      user_shortname: profile.user_shortname,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch profile" });
  }
});
