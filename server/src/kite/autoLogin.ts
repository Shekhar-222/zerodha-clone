import { chromium, Page } from "playwright";
import fs from "fs";
import path from "path";
import { kite } from "./kiteClient";
import { config } from "../config";
import { generateTotp, totpMsRemaining } from "./totp";

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

// Clicking a submit button that immediately triggers a page navigation can make Playwright's
// own post-click actionability re-check throw — the button element gets removed from the DOM
// the instant the page navigates, and Playwright reports that as an error even though the
// click itself already landed. Whether it actually worked is verified separately by the
// caller (waiting for the next page state to appear), so a throw here is safe to ignore.
async function clickTolerant(page: Page, selector: string) {
  try {
    await page.click(selector, { timeout: 10000 });
  } catch (err: any) {
    console.warn(`[auto-login] click(${selector}) raised — likely a benign navigation race:`, err.message);
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
  if (!config.kiteUserId || !config.kitePassword || !config.kiteTotpSecret) {
    console.warn("[auto-login] KITE_USER_ID / KITE_PASSWORD / KITE_TOTP_SECRET not set — skipping");
    return false;
  }

  console.log("[auto-login] starting headless Kite login...");
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  let page: Page | undefined;
  try {
    page = context.pages()[0] ?? (await context.newPage());

    // Capture the `login` result at the network layer — the actual HTTP request the browser
    // makes for the final redirect — rather than by re-reading page.url() afterward. Our own
    // frontend strips that query param off the URL (via history.replaceState) within
    // milliseconds of landing, sometimes fast enough to beat even a navigation-event listener,
    // so anything that inspects the DOM/URL after the fact is unreliable here.
    let capturedLoginResult: string | null = null;
    page.on("request", (req) => {
      try {
        const url = new URL(req.url());
        if (url.origin === new URL(config.clientUrl).origin) {
          const login = url.searchParams.get("login");
          if (login) capturedLoginResult = login;
        }
      } catch {
        // ignore malformed URLs
      }
    });

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
    await clickTolerant(page, 'button[type="submit"]');

    // The PIN/TOTP step replaces the password form entirely once credentials are accepted —
    // waiting for #password to be removed is a reliable signal step 2 has rendered, and is
    // resilient to Kite renaming the second-factor field's id.
    try {
      await page.waitForSelector("#password", { state: "detached", timeout: 15000 });
    } catch {
      await dumpDebugState(page, "password step never advanced to second factor");
      return false;
    }

    // A fresh code, generated as late as possible: if the current 30s window is about to
    // roll over, wait it out first so Kite doesn't receive a code that expires in transit.
    if (totpMsRemaining() < 4000) {
      await page.waitForTimeout(totpMsRemaining() + 500);
    }
    const totpCode = generateTotp(config.kiteTotpSecret);

    const secondFactorInput = page
      .locator('input[type="password"], input[type="text"], input[type="tel"], input[type="number"]')
      .last();
    await secondFactorInput.fill(totpCode);
    await clickTolerant(page, 'button[type="submit"]');

    // A successful second factor ends with Kite redirecting through our callback route and
    // on to the frontend, carrying the result as a `login` query param — already being
    // captured by the `request` listener registered above, at the network layer, the moment
    // the browser makes that request. Poll for it rather than re-inspecting page.url() here:
    // the frontend strips that query param off the URL within milliseconds of landing, fast
    // enough to beat even a navigation-event-based check on a fully successful login.
    const deadline = Date.now() + 20000;
    while (capturedLoginResult === null && Date.now() < deadline) {
      await page.waitForTimeout(200);
    }

    if (capturedLoginResult === null) {
      await dumpDebugState(page, "never redirected back to the app after second factor");
      return false;
    }

    const ok = capturedLoginResult === "success";
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
