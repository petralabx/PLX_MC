// Reads the revenue forecast's two datasets inside the refresh's read-only
// REPEATABLE READ transaction (refresh.readDatasets), TASK-3151: the access
// check first, then both queries, or neither. Missing grants never fail the
// refresh. The order lines carry Sage's item category only once the login may
// read it (TASK-3177); until then they read without it. Server-only.

import { missingForecastAccess, missingForecastCategoryAccess } from "./queries/forecast-access";
import { forecastAosQuery } from "./queries/forecast-assembly-orders";
import { forecastOrdersQuery } from "./queries/forecast-orders";
import type { SourceQuery } from "./source-db";
import type { ForecastDatasets, IsoDate } from "./types";

export async function readForecast(q: SourceQuery, today: IsoDate): Promise<ForecastDatasets> {
  const missing = await missingForecastAccess(q);
  const categoryMissing = await missingForecastCategoryAccess(q);
  if (missing.length > 0) return { access: "missing", missing, categoryMissing, lines: [], aos: [] };
  const orders = forecastOrdersQuery(categoryMissing.length === 0);
  return {
    access: "read",
    missing: [],
    categoryMissing,
    lines: orders.map(await q(orders.sql, [today])),
    aos: forecastAosQuery.map(await q(forecastAosQuery.sql, [today])),
  };
}
