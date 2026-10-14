// Exact money arithmetic for the Goals & Production report. Sources arrive as
// decimal strings (Sage text columns, Postgres numeric); amounts become integer
// cents here and are only formatted for display. Currency conversion rounds each
// converted amount to the cent, half to even — the rule that reproduces the
// published 2026-10-14 figures (25,750 × 1.4219 = 36,613.925 → 36,613.92).
// BigInt keeps products exact; BigInt() calls, not literals (tsconfig targets ES2017).

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

interface Decimal {
  units: bigint;
  scale: number;
}

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function parseDecimal(value: string): Decimal {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
    throw new RangeError(`not a decimal amount: ${JSON.stringify(value)}`);
  }
  const fraction = match[3] ?? "";
  const units = BigInt(`${match[2] || "0"}${fraction}`);
  return { units: match[1] === "-" ? -units : units, scale: fraction.length };
}

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/** numerator / denominator rounded half to even (denominator > 0). */
function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < ZERO;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const twiceRemainder = (magnitude % denominator) * TWO;
  if (twiceRemainder > denominator || (twiceRemainder === denominator && quotient % TWO === ONE)) {
    quotient += ONE;
  }
  return negative ? -quotient : quotient;
}

function toSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError(`amount out of range: ${value}`);
  return result;
}

/** A decimal amount (string) as integer cents; null and "" count as 0. */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const { units, scale } = parseDecimal(String(value));
  if (scale <= 2) return toSafeNumber(units * pow10(2 - scale));
  return toSafeNumber(divideHalfEven(units, pow10(scale - 2)));
}

/** cents × rate, rounded to the cent half to even (USD → CAD at USD/CAD). */
export function convertCents(cents: number, rate: string): number {
  const { units, scale } = parseDecimal(rate);
  return toSafeNumber(divideHalfEven(BigInt(cents) * units, pow10(scale)));
}

/** cents ÷ rate, rounded to the cent half to even (CAD → USD at USD/CAD). */
export function invertCents(cents: number, rate: string): number {
  const { units, scale } = parseDecimal(rate);
  if (units <= ZERO) throw new RangeError(`rate must be positive: ${rate}`);
  return toSafeNumber(divideHalfEven(BigInt(cents) * pow10(scale), units));
}

/** numerator × factor ÷ divisor in cents, rounded half to even (pro-rata targets). */
export function prorateCents(cents: number, factor: number, divisor: number): number {
  if (divisor <= 0) return 0;
  return toSafeNumber(divideHalfEven(BigInt(cents) * BigInt(factor), BigInt(divisor)));
}

/** Integer cents as a plain decimal string, e.g. 36701416 → "367014.16". */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const magnitude = Math.abs(cents);
  return `${sign}${Math.trunc(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`;
}

/** Whole-dollar display, e.g. 36701416 → "$367,014" (display only). */
export function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}
