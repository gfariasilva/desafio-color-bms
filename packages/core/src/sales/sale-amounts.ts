import { RATE_PPM_MAX } from "../payments/rate";

/**
 * RN-02 / RN-03: the fee and net value of a sale, in integer cents.
 *
 * - RN-02: fee = round(gross × rate% ÷ 100; 2 decimals). The rate is stored as percent ×
 *   10,000 (ppm), so fee = gross × ratePpm ÷ 1,000,000, rounded **half-up** per sale
 *   (spec §5 "Valores monetários": 0,005 → 0,01).
 * - RN-03: net = gross − fee.
 *
 * Negative amounts (refunds, #6) round half **away from zero**, so a full refund is the exact
 * mirror of its sale (−5,685 → −5,69) and the two add up to zero.
 */

export interface SaleAmounts {
  feeCents: number;
  netCents: number;
}

/**
 * Integer division rounded half away from zero, without floats:
 * roundHalfUpDiv(5, 10) = 1, roundHalfUpDiv(-5, 10) = -1. `divisor` must be positive.
 */
export function roundHalfUpDiv(dividend: number, divisor: number): number {
  const sign = dividend < 0 ? -1 : 1;
  const absolute = Math.abs(dividend);
  // floor((a + d/2) / d) with integers: quotient, then compare twice the remainder.
  const quotient = Math.trunc(absolute / divisor);
  const remainder = absolute - quotient * divisor;
  const rounded = remainder * 2 >= divisor ? quotient + 1 : quotient;
  return rounded === 0 ? 0 : sign * rounded; // never -0
}

/** RN-02 / RN-03: the sale's fee and net value. `ratePpm` is 0 for sales without a fee. */
export function calculateSaleAmounts(grossCents: number, ratePpm: number): SaleAmounts {
  if (!Number.isSafeInteger(grossCents)) {
    throw new RangeError(`calculateSaleAmounts expects integer cents, received ${grossCents}`);
  }
  if (!Number.isSafeInteger(ratePpm) || ratePpm < 0 || ratePpm > RATE_PPM_MAX) {
    throw new RangeError(`calculateSaleAmounts expects a rate in ppm, received ${ratePpm}`);
  }
  const product = grossCents * ratePpm;
  // The largest sale (R$ 999.999,99) × 100% is 10^14, far below 2^53: the product is exact.
  if (!Number.isSafeInteger(product)) {
    throw new RangeError("calculateSaleAmounts: amount too large");
  }
  const feeCents = roundHalfUpDiv(product, 1_000_000);
  return { feeCents, netCents: grossCents - feeCents };
}
