import { ContractItem, getContractParts, ordinalSuffix } from "../formatContract";

export function ContractLabel({ item, className }: { item: ContractItem; className?: string }) {
  const parts = getContractParts(item);
  if (!parts) return <span className={className}>{item.tradingsymbol}</span>;

  const strikeAndType = parts.type === "FUT" ? "FUT" : `${parts.strike ?? ""} ${parts.type}`;

  return (
    <span className={className}>
      {parts.underlying}{" "}
      {parts.isWeekly && (
        <>
          {parts.day}
          <sup>{ordinalSuffix(parts.day)}</sup>{" "}
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-link/15 align-middle text-[9px] font-semibold leading-none text-link">
            W
          </span>{" "}
        </>
      )}
      {parts.monthStr} {strikeAndType}
    </span>
  );
}
