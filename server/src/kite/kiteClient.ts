import { KiteConnect } from "kiteconnect";
import { config } from "../config";
import { db } from "../db/db";
import { stopTicker } from "./ticker";

export const kite = new KiteConnect({ api_key: config.kiteApiKey });

// The actual session-expiry hook (clear + stop ticker + attempt auto re-login) is registered
// in index.ts rather than here, since it needs autoLogin.ts, which itself imports `kite` from
// this module — registering it here would create a circular import.

export function clearSession() {
  db.prepare("DELETE FROM kite_sessions WHERE user_id = ?").run(config.defaultUserId);
}

export function loadStoredSession(): string | null {
  const row = db
    .prepare("SELECT access_token FROM kite_sessions WHERE user_id = ?")
    .get(config.defaultUserId) as { access_token: string | null } | undefined;

  if (row?.access_token) {
    kite.setAccessToken(row.access_token);
    return row.access_token;
  }
  return null;
}

export function storeSession(accessToken: string, publicToken: string) {
  db.prepare(
    `INSERT INTO kite_sessions (user_id, access_token, public_token, login_time)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       public_token = excluded.public_token,
       login_time = excluded.login_time`
  ).run(config.defaultUserId, accessToken, publicToken);
  kite.setAccessToken(accessToken);
}

export function hasActiveSession(): boolean {
  return loadStoredSession() !== null;
}

export async function logout() {
  try {
    // Best-effort: actually invalidates the token on Kite's side too, not just locally, so
    // it can't keep being used elsewhere. If it's already expired/invalid this just no-ops.
    await kite.invalidateAccessToken();
  } catch (err) {
    console.warn("[kite] invalidateAccessToken failed (token may already be invalid)", err);
  }
  clearSession();
  stopTicker();
}
