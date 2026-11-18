/**
 * FR-01: turns an amount typed by the owner into integer cents (NFR-12), without floats.
 *
 * Accepted (pt-BR): "25" (R$ 25,00), "25,5" (R$ 25,50), "1.234,56", "1234,56", "R$ 25,00".
 * A dot followed by 1–2 digits at the end is read as the decimal separator ("25.50"), because
 * the numeric keypad may type a dot; dots in groups of 3 are thousands ("1.234" = R$ 1.234,00).
 */

/** The largest sale amount: R$ 999.999,99 (owner decision, #4). */
export const MAX_SALE_CENTS = 99_999_999;

/** Reais with optional thousands dots, then an optional "," or "." and 1–2 decimals. */
const MONEY_PATTERN = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const DOT_DECIMAL_PATTERN = /^(\d+)\.(\d{1,2})$/;

/**
 * Returns the amount in cents, or null when the text is not an amount from R$ 0,01 to
 * MAX_SALE_CENTS. Only string and integer work: "0,29" is exactly 29.
 */
export function parseMoneyToCents(text: string): number | null {
  const cents = parseMoneyText(text);
  return cents !== null && cents >= 1 && cents <= MAX_SALE_CENTS ? cents : null;
}

/**
 * The cents of any well-formed amount, without the 0 < amount ≤ maximum check, so a form
 * can tell "not a number" from "too large" (the schema then gives the right message).
 * Null for malformed text or more than 12 digits of reais.
 */
export function parseMoneyText(text: string): number | null {
  const cleaned = text.replace(/\s+/g, "").replace(/^R\$/i, "");
  const dotDecimal = DOT_DECIMAL_PATTERN.exec(cleaned);
  const match = dotDecimal ?? MONEY_PATTERN.exec(cleaned);
  if (!match) return null;
  const reais = match[1]!.replaceAll(".", "");
  const decimals = match[2] ?? "";

  // Keeps Number() exact (safe integers) for any text that gets this far.
  if (reais.length > 12) return null;
  return Number(reais) * 100 + Number(decimals.padEnd(2, "0"));
}
