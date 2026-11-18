/**
 * Money is always an integer number of cents (NFR-12). This module only turns cents into
 * text for the pt-BR UI; it never does arithmetic with floats.
 */

/** Non-breaking space: keeps "R$" and the number on the same line in tables. */
const NBSP = " ";

/**
 * Formats integer cents as Brazilian currency.
 *
 * @example formatCents(123456)  // "R$ 1.234,56"
 * @example formatCents(-8000)   // "-R$ 80,00"
 * @throws RangeError when `cents` is not a safe integer.
 */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`formatCents expects integer cents, received ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const reais = Math.trunc(absolute / 100); // integer division: exact for safe integers
  const centavos = absolute % 100;
  const reaisWithDots = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$${NBSP}${reaisWithDots},${String(centavos).padStart(2, "0")}`;
}
