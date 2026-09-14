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
  autoLogin().catch((err) => console.error("[auto-login] retry on expiry failed", err));
});

async function connect() {
  // If we already have a valid access token from an earlier login today, resume the live
  // feed and warm the instrument cache without requiring the user to log in again.
  const existingToken = loadStoredSession();
  if (existingToken) {
    startTicker(existingToken);
    subscribeTokens(getAllTrackedInstrumentTokens());
    syncInstrumentsIfNeeded().catch((err) => console.error("[startup] instrument sync failed", err));
    return;
  }

  console.log("[server] no active Kite session — attempting auto-login...");
  const ok = await autoLogin();
  if (!ok) {
    console.log("[server] auto-login unavailable/failed — visit /api/auth/login to log in manually");
  }
}

connect();
