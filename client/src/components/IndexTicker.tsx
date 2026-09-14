import { useEffect, useState } from "react";
import { api, IndexQuote } from "../api";

function IndexItem({ quote }: { quote: IndexQuote }) {
  const positive = quote.change >= 0;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="font-medium text-[#1a1a1a]">{quote.name}</span>
      <span className={positive ? "text-gain" : "text-loss"}>{quote.last_price.toFixed(2)}</span>
      <span className={positive ? "text-gain" : "text-loss"}>
        {positive ? "+" : ""}
        {quote.change.toFixed(2)} ({positive ? "+" : ""}
        {quote.change_percent.toFixed(2)}%)
      </span>
    </span>
  );
}

export function IndexTicker() {
  const [indices, setIndices] = useState<Record<string, IndexQuote>>({});

  useEffect(() => {
    function load() {
      api.getIndices().then(setIndices).catch(() => {});
    }
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="overflow-x-auto border-b border-gray-200 bg-white px-4 py-1.5 text-xs">
      <div className="flex w-max gap-6">
        {indices.NIFTY && <IndexItem quote={indices.NIFTY} />}
        {indices.SENSEX && <IndexItem quote={indices.SENSEX} />}
      </div>
    </div>
  );
}
