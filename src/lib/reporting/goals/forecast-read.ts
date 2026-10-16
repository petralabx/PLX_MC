// Reads the revenue forecast's two datasets inside the refresh's read-only
// REPEATABLE READ transaction (refresh.readDatasets), TASK-3151: the access
// check first, then both queries, or neither. Missing grants never fail the
// refresh. Server-only.

import { missingForecastAccess } from "./queries/forecast-access";
import { forecastAosQuery } from "./queries/forecast-assembly-orders";
import { forecastOrdersQuery } from "./queries/forecast-orders";
import type { SourceQuery } from "./source-db";
import type { ForecastDatasets, IsoDate } from "./types";

export async function readForecast(q: SourceQuery, today: IsoDate): Promise<ForecastDatasets> {
  const missing = await missingForecastAccess(q);
  if (missing.length > 0) return { access: "missing", missing, lines: [], aos: [] };
  return {
    access: "read",
    missing: [],
    lines: forecastOrdersQuery.map(await q(forecastOrdersQuery.sql, [today])),
    aos: forecastAosQuery.map(await q(forecastAosQuery.sql, [today])),
  };
}
