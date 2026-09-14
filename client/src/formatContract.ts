const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type ContractItem = {
  tradingsymbol: string;
  name?: string | null;
  instrument_type?: string | null;
  expiry?: string | null;
  strike?: number | null;
};

export type ContractParts = {
  underlying: string;
  monthStr: string;
  day: number;
  isWeekly: boolean;
  strike?: number | null;
  type: "FUT" | "CE" | "PE";
};

export function ordinalSuffix(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

// NSE has changed which weekday it uses for weekly expiry more than once, so rather than
// hardcoding "Thursday", detect "monthly" as "the last occurrence of this weekday in the
// month" — true for a monthly contract regardless of which day of the week it falls on,
// and false for any weekly contract that isn't also the month's final one.
function isMonthlyExpiry(date: Date): boolean {
  const next = new Date(date.getTime());
  next.setUTCDate(date.getUTCDate() + 7);
  return next.getUTCMonth() !== date.getUTCMonth();
}

/**
 * Kite's raw tradingsymbol for derivatives is a dense code meant for the API, not for
 * reading — and the format isn't even consistent: monthly contracts spell the month out
 * (RELIANCE26SEPFUT) but weekly index options use a single-character month code instead
 * (NIFTY2691523300PE = NIFTY, 26, month 9, day 15, strike 23300, PE). Kite's own `name`
 * field is already just the plain underlying name ("RELIANCE", "NIFTY") regardless of
 * contract format, so building the label from that plus the expiry/strike we already store
 * is far more robust than trying to parse the symbol.
 */
export function getContractParts(item: ContractItem): ContractParts | null {
  if (!item.instrument_type || item.instrument_type === "EQ") return null;
  if (!item.expiry) return null;

  const date = new Date(item.expiry);
  if (isNaN(date.getTime())) return null;

  const type = item.instrument_type as "FUT" | "CE" | "PE";

  return {
    underlying: item.name || item.tradingsymbol,
    monthStr: MONTHS[date.getUTCMonth()],
    day: date.getUTCDate(),
    isWeekly: type !== "FUT" && !isMonthlyExpiry(date),
    strike: item.strike,
    type,
  };
}

export function formatContractLabel(item: ContractItem): string {
  const parts = getContractParts(item);
  if (!parts) return item.tradingsymbol;

  const dayPart = parts.isWeekly ? `${parts.day}${ordinalSuffix(parts.day)} ` : "";

  if (parts.type === "FUT") {
    return `${parts.underlying} ${dayPart}${parts.monthStr} FUT`;
  }

  const strike = parts.strike != null ? parts.strike : "";
  return `${parts.underlying} ${dayPart}${parts.monthStr} ${strike} ${parts.type}`;
}
