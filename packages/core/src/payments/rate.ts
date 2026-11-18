import { z } from "zod";

/**
 * FR-15: card-machine fee rates (spec §3 "Taxa").
 *
 * A rate is stored as an integer: percent × 10,000, which is the same as parts per million
 * (ADR 0001). So 3,79% → 37900 and 100% → 1,000,000. This keeps 4 decimal places of percent
 * exactly, with no floating point. RN-02 will compute the fee as
 * roundHalfUp(grossCents × ratePpm / 1,000,000) with integer arithmetic (#4).
 */

/** 100%: the largest rate the fee table accepts. */
export const RATE_PPM_MAX = 1_000_000;

/** Digits after the decimal separator that a rate can have (4: "1,2345%"). */
const RATE_DECIMALS = 4;

/** "3,79", "3.79", "3,79%" or "3": an integer part and up to 4 decimals, nothing else. */
const RATE_PATTERN = /^(\d{1,3})(?:[.,](\d{1,4}))?$/;

/**
 * FR-15: turns what the owner typed ("3,79" or "3,79%") into percent × 10,000 (37900).
 * Works on the text itself, never with parseFloat, so "0,3" is exactly 3000.
 * Returns null for anything that is not a rate from 0% to 100% with at most 4 decimals.
 */
export function parseRatePercent(text: string): number | null {
  const cleaned = text.trim().replace(/\s*%$/, "");
  const match = RATE_PATTERN.exec(cleaned);
  if (!match) return null;
  const integerPart = Number(match[1]);
  const decimals = (match[2] ?? "").padEnd(RATE_DECIMALS, "0");
  const ppm = integerPart * 10_000 + Number(decimals);
  return ppm <= RATE_PPM_MAX ? ppm : null;
}

/**
 * FR-15: the rate as a pt-BR decimal number, without "%": 37900 → "3,79", 12345 → "1,2345".
 * Always at least 2 decimals; trailing zeros after that are dropped. Used to fill an edit form.
 */
export function formatRateDecimal(ratePpm: number): string {
  if (!Number.isSafeInteger(ratePpm) || ratePpm < 0) {
    throw new RangeError(`formatRateDecimal expects a non-negative integer, received ${ratePpm}`);
  }
  const integerPart = Math.trunc(ratePpm / 10_000);
  const decimals = String(ratePpm % 10_000)
    .padStart(RATE_DECIMALS, "0")
    // Drop trailing zeros, but keep the first 2 decimals: "7900" → "79", "0000" → "00".
    .replace(/^(\d{2}\d*?)0*$/, "$1");
  return `${integerPart},${decimals}`;
}

/** FR-15: the rate for display: 37900 → "3,79%". */
export function formatRatePercent(ratePpm: number): string {
  return `${formatRateDecimal(ratePpm)}%`;
}

/** The stored rate: an integer from 0 (0%) to RATE_PPM_MAX (100%). */
export const ratePercentSchema = z
  .number({ message: "Informe a taxa." })
  .int("Taxa inválida: use de 0% a 100%.")
  .min(0, "Taxa inválida: use de 0% a 100%.")
  .max(RATE_PPM_MAX, "Taxa inválida: use de 0% a 100%.");
