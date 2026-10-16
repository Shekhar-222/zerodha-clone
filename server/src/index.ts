import express from "express";
import cors from "cors";
import { createServer } from "http";
import { config } from "./config";
import { initDb, getAllTrackedInstrumentTokens } from "./db/db";
import { kite, clearSession, loadStoredSession } from "./kite/kiteClient";
import { startTicker, subscribeTokens, stopTicker } from "./kite/ticker";
import { syncInstrumentsIfNeeded } from "./kite/instruments";
import { autoLogin } from "./kite/autoLogin";
import { attachWsServer } from "./ws/wsServer";
import { authRouter } from "./routes/auth";
import { instrumentsRouter } from "./routes/instruments";
import { watchlistRouter } from "./routes/watchlist";
import { quotesRouter } from "./routes/quotes";
import { ordersRouter } from "./routes/orders";
import { portfolioRouter } from "./routes/portfolio";
import { scheduleDailyOrderReset } from "./services/dailyReset";

initDb();

const app = express();
app.use(cors({ origin: config.clientUrl }));
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/instruments", instrumentsRouter);
app.use("/api/watchlist", watchlistRouter);
app.use("/api/quotes", quotesRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/portfolio", portfolioRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
attachWsServer(httpServer);

httpServer.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});

scheduleDailyOrderReset();

// Kite calls this when a REST request comes back with a TokenException — the access token
// has been invalidated (daily expiry, or the session was revoked). Without this, a dead
// token stays silently stored and /api/auth/status keeps reporting loggedIn:true — the app
// looks connected while every quote/order call fails and the ticker spins retrying forever.
kite.setSessionExpiryHook(() => {
  console.warn("[kite] session expired — clearing stored token and attempting auto re-login");
  clearSession();
  stopTicker();
  tryAutoLogin("session expired").catch((err) => console.error("[auto-login] retry on expiry failed", err));
});

// A failed auto-login (bad password/TOTP, Kite page change) shouldn't be hammered every
// check — repeated wrong-credential attempts can get the Kite account locked.
const AUTO_LOGIN_RETRY_MS = 30 * 60 * 1000;
let lastAutoLoginFailureAt = 0;

async function tryAutoLogin(reason: string) {
  if (Date.now() - lastAutoLoginFailureAt < AUTO_LOGIN_RETRY_MS) return;
  console.log(`[server] ${reason} — attempting auto-login...`);
  const ok = await autoLogin();
  if (ok) {
    lastAutoLoginFailureAt = 0;
    syncInstrumentsIfNeeded().catch((err) => console.error("[startup] instrument sync failed", err));
  } else {
    lastAutoLoginFailureAt = Date.now();
    console.log("[server] auto-login unavailable/failed — will retry in 30 min, or visit /api/auth/login to log in manually");
  }
}

/**
 * Kite access tokens die every morning (~6 AM IST), but nothing announces it: the ticker just
 * drops and reconnects with the dead token, and the expiry hook only fires once some REST call
 * happens to be rejected. A token stored yesterday also survives a server restart. So verify
 * the session with a cheap live call — at startup and then periodically — and log in again
 * as soon as it's gone, instead of waiting for someone to open the app and notice.
 */
async function ensureSession() {
  const token = loadStoredSession();
  if (!token) {
    await tryAutoLogin("no active Kite session");
    return;
  }

  try {
    await kite.getProfile();
  } catch (err: any) {
    if (err?.error_type === "TokenException") {
      // The expiry hook has already cleared the session and kicked off a re-login.
      return;
    }
    console.warn("[server] session check failed (network?), will re-check shortly:", err?.message ?? err);
  }
}

async function connect() {
  const existingToken = loadStoredSession();
  if (existingToken) {
    try {
      await kite.getProfile();
      // Still valid from an earlier login today — resume the live feed without logging in again.
      startTicker(existingToken);
      subscribeTokens(getAllTrackedInstrumentTokens());
      syncInstrumentsIfNeeded().catch((err) => console.error("[startup] instrument sync failed", err));
      return;
    } catch (err: any) {
      if (err?.error_type === "TokenException") return; // expiry hook is re-logging in
      console.warn("[startup] could not verify stored session, starting feed anyway:", err?.message ?? err);
      startTicker(existingToken);
      subscribeTokens(getAllTrackedInstrumentTokens());
      return;
    }
  }

  await tryAutoLogin("no active Kite session");
}

connect().finally(() => {
  setInterval(() => {
    ensureSession().catch((err) => console.error("[server] session check failed", err));
  }, 5 * 60 * 1000);
});
