import { Bell, LogOut, Menu, ShoppingCart } from "lucide-react";
import { Profile } from "../api";

export type Tab = "dashboard" | "chart" | "orders" | "holdings" | "positions" | "funds" | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "chart", label: "Chart" },
  { id: "orders", label: "Orders" },
  { id: "holdings", label: "Holdings" },
  { id: "positions", label: "Positions" },
  { id: "funds", label: "Funds" },
  { id: "history", label: "History" },
];

export function HeaderNav({
  tab,
  onTabChange,
  profile,
  onToggleWatchlist,
  onLogout,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  profile: Profile | null;
  onToggleWatchlist: () => void;
  onLogout: () => void;
}) {
  const initials = profile?.user_shortname?.slice(0, 2).toUpperCase() ?? "??";

  const tabButton = (t: (typeof TABS)[number], extraClass: string) => (
    <button
      key={t.id}
      onClick={() => onTabChange(t.id)}
      className={`shrink-0 border-b-2 py-2 -mb-2 transition-colors ${extraClass} ${
        tab === t.id
          ? "border-accent text-accent font-medium"
          : "border-transparent text-gray-600 hover:text-gray-900"
      }`}
    >
      {t.label}
    </button>
  );

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="flex items-center gap-3 px-3 py-2 sm:gap-6 sm:px-4">
        <button
          onClick={onToggleWatchlist}
          className="text-gray-500 hover:text-gray-800 md:hidden"
          title="Watchlist"
        >
          <Menu size={20} />
        </button>

        <div className="flex select-none items-center gap-1.5 text-lg font-semibold text-accent">
          <span className="inline-block h-5 w-5 shrink-0 rounded-sm bg-accent" />
          Kite Paper
        </div>

        <div className="hidden flex-1 justify-end md:flex">
          <nav className="mr-8 flex items-center gap-6 text-sm">
            {TABS.map((t) => tabButton(t, ""))}
          </nav>
        </div>

        <div className="ml-auto flex items-center gap-3 text-gray-500 sm:gap-4 md:ml-0">
          <button className="hover:text-gray-800" title="Order basket">
            <ShoppingCart size={18} />
          </button>
          <button className="hover:text-gray-800" title="Notifications">
            <Bell size={18} />
          </button>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-accent">
              {initials}
            </span>
            <span className="hidden text-sm text-gray-700 sm:inline">{profile?.user_id ?? ""}</span>
          </div>
          <button onClick={onLogout} className="hover:text-loss" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <nav className="flex gap-5 overflow-x-auto border-t border-gray-100 px-3 py-2 text-sm md:hidden">
        {TABS.map((t) => tabButton(t, ""))}
      </nav>
    </header>
  );
}
