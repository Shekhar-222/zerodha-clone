import { Funds } from "../api";

export function FundsBar({ funds }: { funds: Funds | null }) {
  if (!funds) return null;
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
      <div>
        <div className="text-xs text-gray-500">Available Margin</div>
        <div className="font-medium tabular-nums text-gray-800">
          ₹{funds.available_balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-500">Used Margin</div>
        <div className="font-medium tabular-nums text-gray-800">
          ₹{funds.used_margin.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-500">Cash Balance</div>
        <div className="font-medium tabular-nums text-gray-800">
          ₹{funds.cash_balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </div>
      </div>
    </div>
  );
}
