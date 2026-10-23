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

/**
 * The exact sum of decimal amounts less the exact sum of `minus`, rounded to the
 * cent once, half to even. Sage keeps three decimals on invoice lines, so they
 * are added up before rounding, never rounded one by one (TASK-3144).
 */
export function sumToCents(plus: readonly string[], minus: readonly string[] = []): number {
  const terms = [...plus.map((v) => ({ ...parseDecimal(v), sign: ONE })), ...minus.map((v) => ({ ...parseDecimal(v), sign: -ONE }))];
  const scale = Math.max(2, ...terms.map((t) => t.scale));
  const total = terms.reduce((sum, t) => sum + t.sign * t.units * pow10(scale - t.scale), ZERO);
  return toSafeNumber(divideHalfEven(total, pow10(scale - 2)));
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

/** A USD/CAD rate as a usable decimal string (positive, at most 6 places, like report_fx_rate), else null. */
export function usableRate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!/^\d*(\.\d{0,6})?$/.test(text) || !/\d/.test(text)) return null;
  return parseDecimal(text).units > ZERO ? text : null;
}

/** p ÷ d rounded toward −∞ (d > 0); BigInt division truncates toward zero. */
function floorDiv(p: bigint, d: bigint): bigint {
  return p >= ZERO ? p / d : -((-p + d - ONE) / d);
}

/**
 * Converts each part (cents) at `rate` so the parts add up to convertCents of
 * their sum exactly (TASK-3781): every part is floored, then the cents still
 * owed go one each to the parts with the largest remainders, ties to the
 * earlier part. A part converted exactly is never bumped, and each result is
 * its own conversion rounded down or up, so a part can be a cent off
 * convertCents of that part alone.
 */
export function allocateConvertedCents(parts: readonly number[], rate: string): number[] {
  const { units, scale } = parseDecimal(rate);
  const d = pow10(scale);
  const products = parts.map((c) => BigInt(c) * units);
  const floors = products.map((p) => floorDiv(p, d));
  const remainders = products.map((p, i) => p - floors[i] * d);
  const target = divideHalfEven(products.reduce((n, p) => n + p, ZERO), d);
  let owed = Number(target - floors.reduce((n, f) => n + f, ZERO));
  const order = parts.map((_, i) => i).sort((a, b) => (remainders[b] > remainders[a] ? 1 : remainders[b] < remainders[a] ? -1 : a - b));
  for (const i of order) {
    if (owed === 0 || remainders[i] === ZERO) break;
    floors[i] += ONE;
    owed -= 1;
  }
  return floors.map(toSafeNumber);
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

/** Exact amount with thousands separators and no symbol, e.g. 444240 → "4,442.40" (display only). */
export function formatAmount(cents: number): string {
  const [whole, frac] = centsToDecimal(Math.abs(cents)).split(".");
  return `${cents < 0 ? "-" : ""}${Number(whole).toLocaleString("en-US")}.${frac}`;
}

/** Whole-dollar display, e.g. 36701416 → "$367,014" (display only). */
export function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}
