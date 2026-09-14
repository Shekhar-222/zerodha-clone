// Kite treats MCX order quantity as a LOT COUNT (e.g. "1" means 1 lot of 100 barrels for
// crude oil), not the physical unit count — confirmed live: a quantity of 100 for CRUDEOIL
// required ~₹3 crore margin (100 lots' worth), while a quantity of 1 required the normal
// ~₹3 lakh (1 lot). But Kite's own price is quoted per physical unit (e.g. per barrel), and
// Kite's own instrument master unhelpfully reports lot_size: 1 for every MCX contract — so
// there's no per-lot multiplier available from Kite's data to convert a price move into real
// rupees. This table supplies that missing multiplier — how many quoting-units are in one lot.
//
// Gold/silver variants were verified by comparing live LTPs across sibling contracts rather
// than assumed: GOLDPETAL (per gram) × 8 landed within 0.05% of GOLDGUINEA's own LTP, and
// GOLDTEN × 0.8 landed within 0.4% of it too — confirming GOLDPETAL is quoted per gram,
// GOLDGUINEA per 8g ("1 guinea"), and GOLDTEN per 10g. SILVERM and SILVERMIC's raw LTPs
// matched each other within 0.1% with no scaling at all, confirming both are quoted directly
// per kilogram. A contract's own lot IS its quoting unit for GOLDTEN/GOLDGUINEA/GOLDPETAL/
// SILVERMIC (multiplier 1, listed anyway to record that it's been verified, not just
// defaulted), while GOLDM (100g lot / 10g unit) and SILVERM (5kg lot / 1kg unit) need scaling.
export const MCX_LOT_SIZES: Record<string, number> = {
  CRUDEOIL: 100,
  CRUDEOILM: 10,
  NATURALGAS: 1250,
  NATGASMINI: 250,
  COPPER: 2500,
  GOLDTEN: 1,
  GOLDM: 10,
  GOLDGUINEA: 1,
  GOLDPETAL: 1,
  SILVERMIC: 1,
  SILVERM: 5,
  SILVER: 30,
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
