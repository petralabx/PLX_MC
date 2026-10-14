// Shared month window for the dataset queries. $1 is always today's Toronto
// date (bound — never the database's UTC current_date). Bounds are computed
// from dates only, so they do not depend on the session time zone; Sage stores
// dates as YYYYMMDD text, hence the *s string forms.
//   m0 / m1  first and last day of this month
//   p0s      first day of last month (YYYYMMDD)
//   m0s/n0s  first day of this / next month (YYYYMMDD)

export const MONTH_WINDOW = `
WITH p AS (SELECT CAST($1 AS date) AS today),
cut AS (
  SELECT p.today,
         m.m0,
         (m.m0 + interval '1 month' - interval '1 day')::date AS m1,
         to_char(m.m0, 'YYYYMMDD') AS m0s,
         to_char(m.m0 - interval '1 month', 'YYYYMMDD') AS p0s,
         to_char(m.m0 + interval '1 month', 'YYYYMMDD') AS n0s
  FROM p, LATERAL (
    SELECT make_date(extract(year FROM p.today)::int, extract(month FROM p.today)::int, 1) AS m0
  ) m
)`;

/** A dataset query: its name (shown in tooltips), SQL, and row mapper. */
export interface DatasetQuery<Row, Out> {
  name: string;
  sql: string;
  map(rows: Row[]): Out;
}
