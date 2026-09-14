// Kite treats MCX order quantity as a LOT COUNT (e.g. "1" means 1 lot of 100 barrels for
// crude oil), not the physical unit count — confirmed live: a quantity of 100 for CRUDEOIL
// required ~₹3 crore margin (100 lots' worth), while a quantity of 1 required the normal
// ~₹3 lakh (1 lot). But Kite's own price is quoted per physical unit (e.g. per barrel), and
// Kite's own instrument master unhelpfully reports lot_size: 1 for every MCX contract — so
// there's no per-lot multiplier available from Kite's data to convert a price move into real
// rupees. This table supplies that missing multiplier, sourced from MCX's published contract
// specifications, for the commodities this app supports with an unambiguous single quoting
// unit. (GOLD/SILVER are deliberately left out — MCX quotes them per-10g in a way that needs
// a real trade example to confirm before it's safe to hardcode.)
export const MCX_LOT_SIZES: Record<string, number> = {
  CRUDEOIL: 100,
  CRUDEOILM: 10,
  NATURALGAS: 1250,
  NATGASMINI: 250,
  COPPER: 2500,
};

/** How many real physical units one unit of stored `quantity` represents — 1 for every
 * non-MCX instrument (where quantity already is the real unit count), or the real lot size
 * for a matched MCX commodity. Multiply any price-difference P&L by this to get real rupees. */
export function mcxUnitMultiplier(exchange: string | null | undefined, name: string | null | undefined): number {
  if (exchange === "MCX" && name && MCX_LOT_SIZES[name]) {
    return MCX_LOT_SIZES[name];
  }
  return 1;
}
