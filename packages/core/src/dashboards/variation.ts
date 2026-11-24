/**
 * RN-11: Variação percentual (dashboards).
 * `variação = (atual − anterior) ÷ |anterior| × 100`, with 1 decimal place; "—" when
 * `anterior = 0`.
 *
 * The result is kept as an **integer number of tenths of a percent** (+12,3 % → 123), so it is
 * computed with integer math only, like money. Rounding is half away from zero (0,05 % → 0,1 %
 * and −0,05 % → −0,1 %), the same symmetric rule as refunds (RN-04).
 */

/**
 * RN-11: the variation from `previousCents` to `currentCents` in tenths of a percent, or
 * `null` when the previous value is 0 (shown as "—").
 *
 * @example variationTenths(1500, 1000) // 500 (+50,0 %)
 * @example variationTenths(-500, -1000) // 500 (a negative balance that halved: +50,0 %)
 * @throws RangeError when an amount is not integer cents.
 */
export function variationTenths(currentCents: number, previousCents: number): number | null {
  if (!Number.isSafeInteger(currentCents) || !Number.isSafeInteger(previousCents)) {
    throw new RangeError(
      `variationTenths expects integer cents, received ${currentCents} and ${previousCents}`,
    );
  }
  if (previousCents === 0) return null;
  // The difference in BigInt: two safe integers can differ by more than a safe integer.
  return roundedTenths(
    BigInt(currentCents) - BigInt(previousCents),
    BigInt(Math.abs(previousCents)),
  );
}

/**
 * `part ÷ base × 100` in tenths of a percent, rounded half away from zero, with integer math
 * only. Shared by RN-11 and the FR-25 share of the total. `base` must be positive.
 *
 * @example percentTenths(1, 3) // 333 (33,3 %)
 * @example percentTenths(-1, 2000) // −1 (−0,05 % → −0,1 %)
 */
export function percentTenths(part: number, base: number): number {
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(base) || base <= 0) {
    throw new RangeError(`percentTenths expects integers and base > 0, received ${part}, ${base}`);
  }
  return roundedTenths(BigInt(part), BigInt(base));
}

/** `part ÷ base × 1000` rounded half away from zero, in BigInt so it stays exact; base > 0. */
function roundedTenths(part: bigint, base: bigint): number {
  // |part| × 1000 / base, rounded half up: floor((2 × n + d) / (2 × d)).
  const numerator = (part < 0n ? -part : part) * 1000n;
  const tenths = Number((2n * numerator + base) / (2n * base));
  return part < 0n && tenths !== 0 ? -tenths : tenths;
}

/** The minus sign used for negative variations (U+2212), as in the spec. */
const MINUS = "−";

/**
 * RN-11: formats a variation in tenths of a percent for the pt-BR UI.
 *
 * @example formatVariation(500) // "+50,0%"
 * @example formatVariation(-123) // "−12,3%"
 * @example formatVariation(null) // "—"
 */
export function formatVariation(tenths: number | null): string {
  if (tenths === null) return "—";
  const sign = tenths > 0 ? "+" : tenths < 0 ? MINUS : "";
  const absolute = Math.abs(tenths);
  const whole = String(Math.trunc(absolute / 10)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${whole},${absolute % 10}%`;
}
