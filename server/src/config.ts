import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  kiteApiKey: required("KITE_API_KEY", ""),
  kiteApiSecret: required("KITE_API_SECRET", ""),
  kiteRedirectUrl: required("KITE_REDIRECT_URL", "http://localhost:4000/api/auth/callback"),
  clientUrl: required("CLIENT_URL", "http://localhost:5173"),
  // Optional — only needed for auto-login (headless re-authentication against Kite's own
  // login page). Left unset, the app falls back to the normal manual /api/auth/login flow.
  kiteUserId: process.env.KITE_USER_ID,
  kitePassword: process.env.KITE_PASSWORD,
  kitePin: process.env.KITE_PIN,
  virtualCapital: Number(process.env.VIRTUAL_CAPITAL ?? 2000000),
  dbPath: path.resolve(__dirname, "..", "data.sqlite"),
  defaultUserId: 1,
};
