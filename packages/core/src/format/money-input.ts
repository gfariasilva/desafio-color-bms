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
  const cleaned = text.replace(/\s+/g, "").replace(/^R\$/i, "");
  const dotDecimal = DOT_DECIMAL_PATTERN.exec(cleaned);
  const match = dotDecimal ?? MONEY_PATTERN.exec(cleaned);
  if (!match) return null;
  const reais = match[1]!.replaceAll(".", "");
  const decimals = match[2] ?? "";

  // Too many digits can never be a valid amount; stops huge numbers before Number().
  if (reais.length > 7) return null;
  const cents = Number(reais) * 100 + Number(decimals.padEnd(2, "0"));
  return cents >= 1 && cents <= MAX_SALE_CENTS ? cents : null;
}
