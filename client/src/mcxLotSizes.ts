// Mirrors server/src/services/mcxLotSizes.ts — kept in sync there since this file needs its
// own copy for instant, tick-driven P&L in the browser without a round-trip per price update.
// See that file's comment for the full explanation of why this multiplier is needed at all:
// Kite treats MCX order quantity as a lot count, quotes price per physical unit, and its own
// instrument data reports lot_size: 1 for every MCX contract regardless.
const MCX_LOT_SIZES: Record<string, number> = {
  CRUDEOIL: 100,
  CRUDEOILM: 10,
  NATURALGAS: 1250,
  NATGASMINI: 250,
  COPPER: 2500,
};

export function mcxUnitMultiplier(exchange: string, name: string | null | undefined): number {
  if (exchange === "MCX" && name && MCX_LOT_SIZES[name]) {
    return MCX_LOT_SIZES[name];
  }
  return 1;
}
