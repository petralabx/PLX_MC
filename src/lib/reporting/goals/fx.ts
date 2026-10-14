// USD/CAD from the Bank of Canada Valet API (series FXUSDCAD — the curve the ERP
// integration also pushes into Business Central). Never Sage's own inrate, which
// is stuck at 1.25. The bank publishes once per business day (about 16:30 ET),
// so at 06:00 the latest rate is the previous business day's.

import { z } from "zod";

import type { FxRate, IsoDate } from "./types";

export const FX_SERIES = "FXUSDCAD";
const VALET_URL = `https://www.bankofcanada.ca/valet/observations/${FX_SERIES}/json`;
const FETCH_TIMEOUT_MS = 10_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATE = /^\d+(\.\d+)?$/;

const valetSchema = z.object({
  observations: z.array(
    z.object({
      d: z.string().regex(ISO_DATE),
      [FX_SERIES]: z.object({ v: z.string() }).optional(),
    })
  ),
});

export type FetchRates = (start: IsoDate, end: IsoDate) => Promise<FxRate[]>;

/** Daily USD/CAD observations from `start` to `end`, inclusive (business days only). */
export async function fetchUsdCadRates(
  start: IsoDate,
  end: IsoDate,
  fetchImpl: typeof fetch = fetch
): Promise<FxRate[]> {
  const url = `${VALET_URL}?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
  const resp = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Bank of Canada Valet returned HTTP ${resp.status}`);
  const parsed = valetSchema.safeParse(await resp.json());
  if (!parsed.success) throw new Error("Bank of Canada Valet response did not match the expected shape");
  const rates: FxRate[] = [];
  for (const observation of parsed.data.observations) {
    const value = observation[FX_SERIES]?.v.trim();
    if (value && RATE.test(value) && Number(value) > 0) rates.push({ date: observation.d, rate: value });
  }
  return rates;
}
