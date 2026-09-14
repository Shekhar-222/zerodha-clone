import { chromium, Page } from "playwright";
import fs from "fs";
import path from "path";
import { kite } from "./kiteClient";
import { config } from "../config";

// A persistent browser profile so Kite sees the same "device" on every auto-login run —
// without it, each headless run looks like a brand-new device/location to Kite, which can
// trigger an email/SMS verification step this script has no way to complete.
const PROFILE_DIR = path.resolve(__dirname, "..", "..", ".kite-browser-profile");

// Where a failed run's screenshot + visible page text get dumped for diagnosis — gitignored,
// overwritten on every failure so it always reflects the most recent attempt.
const DEBUG_DIR = path.resolve(__dirname, "..", "..", ".auto-login-debug");

async function dumpDebugState(page: Page, label: string) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    await page.screenshot({ path: path.join(DEBUG_DIR, "last-failure.png"), fullPage: true });
    const text = await page.evaluate("document.body.innerText").catch(() => "");
    fs.writeFileSync(
      path.join(DEBUG_DIR, "last-failure.txt"),
      `label: ${label}\nurl: ${page.url()}\n\n--- visible text ---\n${text}`
    );
    console.error(`[auto-login] debug state saved to ${DEBUG_DIR} (${label})`);
  } catch (err) {
    console.error("[auto-login] failed to save debug state", err);
  }
}

let inFlight: Promise<boolean> | null = null;

/**
 * Headlessly drives Kite's own login page (userid/password, then PIN) so a fresh
 * access_token can be obtained without a human clicking through the daily login flow.
 * The final redirect lands on our real /api/auth/callback route, which does the actual
 * session exchange/storage exactly as it does for a manual login — this function just
 * gets a browser through the form and lets that existing route take over from there.
 *
 * NOTE: automating Kite's login page like this is outside what Zerodha's Kite Connect
 * terms of service intend the API for. This exists because the user asked for it for their
 * own personal paper-trading account; it should not be adapted for any multi-user product.
 */
export async function autoLogin(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = runAutoLogin();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function runAutoLogin(): Promise<boolean> {
  if (!config.kiteUserId || !config.kitePassword || !config.kitePin) {
    console.warn("[auto-login] KITE_USER_ID / KITE_PASSWORD / KITE_PIN not set — skipping");
    return false;
  }

  console.log("[auto-login] starting headless Kite login...");
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  let page: Page | undefined;
  try {
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto(kite.getLoginURL(), { waitUntil: "domcontentloaded", timeout: 30000 });

    // With the persistent profile, Kite often already remembers the user id from a previous
    // run and skips straight to a password-only screen (id shown as static text + "Change
    // user" instead of an input) — only fill it when it's actually there to be filled.
    const userIdInput = page.locator("#userid");
    if (await userIdInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await userIdInput.fill(config.kiteUserId);
    } else {
      console.log("[auto-login] user id already remembered by this browser profile, skipping");
    }
    await page.fill("#password", config.kitePassword);
    await page.click('button[type="submit"]');

    // The PIN/TOTP step replaces the password form entirely once credentials are accepted —
    // waiting for #password to be removed is a reliable signal step 2 has rendered, and is
    // resilient to Kite renaming the second-factor field's id.
    try {
      await page.waitForSelector("#password", { state: "detached", timeout: 15000 });
    } catch {
      await dumpDebugState(page, "password step never advanced to second factor");
      return false;
    }

    const secondFactorInput = page
      .locator('input[type="password"], input[type="text"], input[type="tel"], input[type="number"]')
      .last();
    await secondFactorInput.fill(config.kitePin);
    await page.click('button[type="submit"]');

    // A successful second factor ends with Kite redirecting through our callback route and
    // on to the frontend — landing there is the signal the session was established.
    try {
      await page.waitForURL((url) => url.origin === new URL(config.clientUrl).origin, { timeout: 20000 });
    } catch {
      await dumpDebugState(page, "never redirected back to the app after second factor");
      return false;
    }

    const ok = page.url().includes("login=success");
    if (ok) {
      console.log("[auto-login] session established");
    } else {
      console.error("[auto-login] landed on", page.url(), "— login did not succeed");
      await dumpDebugState(page, "redirected back but not with login=success");
    }
    return ok;
  } catch (err: any) {
    console.error("[auto-login] failed:", err.message ?? err);
    if (page) await dumpDebugState(page, `unexpected error: ${err.message ?? err}`);
    return false;
  } finally {
    await context.close();
  }
}
