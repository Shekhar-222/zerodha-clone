import { useEffect, useRef, useState } from "react";
import { api, Instrument, Order, Position, Holding, Funds, Profile } from "./api";
import { useLiveData } from "./hooks/useLiveData";
import { IndexTicker } from "./components/IndexTicker";
import { HeaderNav, Tab } from "./components/HeaderNav";
import { Watchlist } from "./components/Watchlist";
import { ChartPanel } from "./components/ChartPanel";
import { PositionsTable } from "./components/PositionsTable";
import { HoldingsTable } from "./components/HoldingsTable";
import { OrdersTable } from "./components/OrdersTable";
import { FundsBar } from "./components/FundsBar";
import { PnlSummary } from "./components/PnlSummary";
import { TradeHistoryTable } from "./components/TradeHistoryTable";
import { EmptyState } from "./components/EmptyState";

const TAB_TITLES: Record<Tab, string> = {
  dashboard: "Dashboard",
  chart: "Chart",
  orders: "Orders",
  holdings: "Holdings",
  positions: "Positions",
  funds: "Funds",
  history: "Trade History",
};

export default function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [autoLoginStatus, setAutoLoginStatus] = useState<"idle" | "trying" | "failed">("idle");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("positions");
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [funds, setFunds] = useState<Funds | null>(null);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [chartInstrument, setChartInstrument] = useState<Instrument | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  function openChart(instrument: Instrument) {
    setChartInstrument(instrument);
    setTab("chart");
  }

  function refreshAll() {
    api.getOrders().then(setOrders).catch(console.error);
    api.getPositions().then(setPositions).catch(console.error);
    api.getHoldings().then(setHoldings).catch(console.error);
    api.getFunds().then(setFunds).catch(console.error);
  }

  const { ltpByToken } = useLiveData(() => refreshAll());

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setLoggedIn(s.loggedIn))
      .catch(() => setLoggedIn(false));

    const params = new URLSearchParams(window.location.search);
    if (params.get("login") === "success") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) {
      refreshAll();
      api.getProfile().then(setProfile).catch(console.error);
    }
  }, [loggedIn]);

  async function tryAutoLogin() {
    setAutoLoginStatus("trying");
    try {
      const { ok } = await api.autoLogin();
      if (ok) {
        setAutoLoginStatus("idle");
        api.authStatus().then((s) => setLoggedIn(s.loggedIn)).catch(() => {});
      } else {
        setAutoLoginStatus("failed");
      }
    } catch {
      setAutoLoginStatus("failed");
    }
  }

  // Auto-login is the preferred path: the moment we know the user is logged out, try it
  // automatically before ever showing the manual button, so a working setup never requires
  // a click. Manual login stays underneath as the fallback for when it isn't configured or
  // doesn't succeed.
  useEffect(() => {
    if (loggedIn === false && autoLoginStatus === "idle") {
      tryAutoLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  async function handleLogout() {
    if (!window.confirm("Log out of Kite? You'll need to log in again to resume live prices.")) return;
    try {
      await api.logout();
    } catch (err) {
      console.error(err);
    } finally {
      setProfile(null);
      setAutoLoginStatus("idle");
      setLoggedIn(false);
    }
  }

  function focusSearch() {
    setWatchlistOpen(true);
    searchInputRef.current?.focus();
  }

  if (loggedIn === null) {
    return <div className="flex min-h-screen items-center justify-center text-gray-500">Loading…</div>;
  }

  if (!loggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f4f4] p-4">
        <div className="w-full max-w-sm rounded-md border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-10">
          <h1 className="mb-2 text-2xl font-semibold text-gray-800">Kite Paper</h1>
          <p className="mb-6 text-gray-500">Log in with your Zerodha Kite account to fetch live market data.</p>

          {autoLoginStatus === "trying" && (
            <div className="mb-5 flex items-center justify-center gap-2 text-sm text-gray-500">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-link" />
              Trying auto-login…
            </div>
          )}
          {autoLoginStatus === "failed" && (
            <p className="mb-5 text-xs text-loss">
              Auto-login failed or isn't configured — log in manually below.
            </p>
          )}

          <a
            href={api.loginUrl()}
            className="rounded bg-link px-4 py-2 font-medium text-white hover:bg-blue-600"
          >
            Login with Kite
          </a>

          {autoLoginStatus === "failed" && (
            <div className="mt-3">
              <button onClick={tryAutoLogin} className="text-sm text-link hover:underline">
                Retry auto-login
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <IndexTicker />
      <HeaderNav
        tab={tab}
        onTabChange={setTab}
        profile={profile}
        onToggleWatchlist={() => setWatchlistOpen((v) => !v)}
        onLogout={handleLogout}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {watchlistOpen && (
          <div
            className="absolute inset-0 z-30 bg-black/30 md:hidden"
            onClick={() => setWatchlistOpen(false)}
          />
        )}

        <div
          className={`absolute inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
            watchlistOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Watchlist
            ltpByToken={ltpByToken}
            onOrderPlaced={refreshAll}
            searchInputRef={searchInputRef}
            onClose={() => setWatchlistOpen(false)}
            onOpenChart={openChart}
          />
        </div>

        <main className="flex-1 overflow-y-auto bg-[#f7f7f7] p-3 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-medium text-gray-800">{TAB_TITLES[tab]}</h1>
            {tab === "dashboard" && <FundsBar funds={funds} />}
          </div>

          <div className="rounded-md border border-gray-200 bg-white p-4">
            {tab === "dashboard" && (
              <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
                <div className="rounded border border-gray-100 p-4">
                  <div className="text-2xl font-semibold text-gray-800">{positions.length}</div>
                  <div className="text-xs text-gray-500">Open Positions</div>
                </div>
                <div className="rounded border border-gray-100 p-4">
                  <div className="text-2xl font-semibold text-gray-800">{holdings.length}</div>
                  <div className="text-xs text-gray-500">Holdings</div>
                </div>
                <div className="rounded border border-gray-100 p-4">
                  <div className="text-2xl font-semibold text-gray-800">
                    {orders.filter((o) => o.status === "OPEN").length}
                  </div>
                  <div className="text-xs text-gray-500">Pending Orders</div>
                </div>
              </div>
            )}
            {tab === "chart" && (
              chartInstrument ? (
                <ChartPanel
                  instrument={chartInstrument}
                  ltp={ltpByToken[chartInstrument.instrument_token]}
                  onOrderPlaced={refreshAll}
                />
              ) : (
                <EmptyState
                  message="Click the chart icon on a watchlist row to view its chart here"
                  ctaLabel="Open watchlist"
                  onCta={focusSearch}
                />
              )
            )}
            {tab === "positions" && (
              <PositionsTable
                positions={positions}
                ltpByToken={ltpByToken}
                onGetStarted={focusSearch}
                onChanged={refreshAll}
              />
            )}
            {tab === "holdings" && (
              <HoldingsTable holdings={holdings} ltpByToken={ltpByToken} onGetStarted={focusSearch} />
            )}
            {tab === "orders" && (
              <OrdersTable
                orders={orders}
                ltpByToken={ltpByToken}
                onChanged={refreshAll}
                onGetStarted={focusSearch}
              />
            )}
            {tab === "funds" && (
              <div>
                <FundsBar funds={funds} />
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <h2 className="mb-3 text-sm font-medium text-gray-700">Profit &amp; Loss by Stock</h2>
                  <PnlSummary />
                </div>
              </div>
            )}
            {tab === "history" && <TradeHistoryTable />}
          </div>
        </main>
      </div>
    </div>
  );
}
