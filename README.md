# Kite Paper — Virtual Trading App

A Zerodha (Kite) clone for practicing trading with virtual money. Live market data (quotes,
instrument list) comes from your own Kite Connect API subscription; every order, fill,
position, holding and rupee of P&L is simulated locally — **nothing is ever sent to an
exchange.**

## Structure
- `server/` — Node.js + TypeScript + Express backend. Talks to Kite Connect for market data
  and runs the virtual order-matching engine against a local SQLite database.
- `client/` — React + Vite + TypeScript frontend (watchlist, order window, positions,
  holdings, orders, funds).

## Prerequisites
- A Kite Connect developer app (api_key + api_secret) from https://developers.kite.trade
  (requires the ₹2000/month Kite Connect subscription on your Zerodha account).
- In your Kite Connect app settings, set the **Redirect URL** to
  `http://localhost:4000/api/auth/callback` (must match `KITE_REDIRECT_URL` below exactly).
- Node.js 18+.

## Setup

### 1. Backend
```
cd server
cp .env.example .env      # then fill in KITE_API_KEY and KITE_API_SECRET
npm install
npm run dev
```
The server starts on http://localhost:4000.

### 2. Frontend
```
cd client
cp .env.example .env
npm install
npm run dev
```
The app opens on http://localhost:5173.

### 3. Log in
Open http://localhost:5173, click **Login with Kite**, and complete Zerodha's login flow.
This is Zerodha's real login (to authorize market data access) — it does not enable real
order placement. The access token Kite issues expires around 6am daily, so you'll need to
log in again each trading day, same as the real Kite web app.

## How the virtual trading works
- **Funds**: seeded with a configurable virtual balance (`VIRTUAL_CAPITAL` in `server/.env`,
  default ₹10,00,000).
- **Market orders** fill immediately at the current LTP from Kite's live tick feed.
- **Limit orders** stay OPEN and fill automatically once a live tick crosses your limit price.
- **Positions/Holdings/P&L** are computed from your simulated fills using weighted-average
  pricing; unrealized P&L updates live as ticks arrive.
- No brokerage/charges, no auto square-off of intraday positions, and no F&O yet — see the
  project plan for what's intentionally out of scope for v1.

## Notes for future multi-user support
The database schema already carries `user_id` on every table (a single default user is
seeded today), so adding real sign-up/login later mainly means adding an auth layer rather
than restructuring data.
