// The reporting MCP path's literal renderer (TASK-3489): execute_sql has no
// bind parameters, so every value the goals queries bind becomes SQL text in
// one place. Each accepted value must come back out of the rendered SQL as
// exactly one literal equal to the input (no injection), and anything else is
// refused without quoting the value.

import { describe, expect, it } from "vitest";

import { renderSql, sqlLiteral, SqlLiteralError } from "@/lib/reporting/goals/sql-literal";
import { batchHistoryQuery } from "@/lib/reporting/goals/queries/batch-history";
import { batchesQuery } from "@/lib/reporting/goals/queries/batches";
import { customersQuery } from "@/lib/reporting/goals/queries/customers";
import { cutoffsQuery } from "@/lib/reporting/goals/queries/cutoffs";
import { dailyQuery } from "@/lib/reporting/goals/queries/daily";
import { forecastAosQuery } from "@/lib/reporting/goals/queries/forecast-assembly-orders";
import { forecastOrdersQuery } from "@/lib/reporting/goals/queries/forecast-orders";
import { missingColumns } from "@/lib/reporting/goals/queries/read-access";
import { referencesQuery } from "@/lib/reporting/goals/queries/references";
import { revenueByCurrencyQuery } from "@/lib/reporting/goals/queries/revenue-by-currency";
import { SHIPMENT_LINE_COLUMNS, shipmentLinesQuery } from "@/lib/reporting/goals/queries/shipment-lines";
import { shipmentsQuery } from "@/lib/reporting/goals/queries/shipments";
import { truckloadsQuery } from "@/lib/reporting/goals/queries/truckloads";

/** Reads one E'…' literal the way Postgres does (\\ and '' escapes); returns its value and what follows. */
function readEString(sql: string): { value: string; rest: string } {
  expect(sql.startsWith("E'")).toBe(true);
  let value = "";
  let i = 2;
  for (;;) {
    const ch = sql[i];
    if (ch === undefined) throw new Error("unterminated");
    if (ch === "\\") {
      value += sql[i + 1];
      i += 2;
    } else if (ch === "'" && sql[i + 1] === "'") {
      value += "'";
      i += 2;
    } else if (ch === "'") {
      return { value, rest: sql.slice(i + 1) };
    } else {
      value += ch;
      i += 1;
    }
  }
}

const ATTACKS = [
  "x'); DROP TABLE report_refresh_run; --",
  "\\'; SELECT pg_sleep(10); --",
  "\\\\'",
  "' OR '1'='1",
  "$1",
  "$$ dollar $$",
  "/* comment */ --",
  'quote " and backslash \\',
  "line\nbreak\r\ttab",
  "ünïcødé 😀 •",
  "",
];

describe("sqlLiteral", () => {
  it.each(ATTACKS)("renders %j as one literal that reads back exactly", (input) => {
    const sql = sqlLiteral(input);
    const { value, rest } = readEString(sql);
    expect(value).toBe(input);
    expect(rest).toBe("");
  });

  it("refuses NUL in strings", () => {
    expect(() => sqlLiteral("a\u0000b")).toThrow(SqlLiteralError);
  });

  it("renders finite numbers in parentheses so a minus can't start a comment", () => {
    expect(sqlLiteral(42)).toBe("(42)");
    expect(sqlLiteral(-5)).toBe("(-5)");
    expect(sqlLiteral(1.5)).toBe("(1.5)");
    expect(renderSql("SELECT 1-$1", [-1])).toBe("SELECT 1-(-1)");
  });

  it.each([NaN, Infinity, -Infinity])("refuses the number %s", (n) => {
    expect(() => sqlLiteral(n)).toThrow(SqlLiteralError);
  });

  it("renders booleans, null and valid dates", () => {
    expect(sqlLiteral(true)).toBe("TRUE");
    expect(sqlLiteral(false)).toBe("FALSE");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(new Date("2026-10-14T10:00:00Z"))).toBe("'2026-10-14T10:00:00.000Z'::timestamptz");
  });

  it("refuses invalid and out-of-pattern dates", () => {
    expect(() => sqlLiteral(new Date("nope"))).toThrow(SqlLiteralError);
    expect(() => sqlLiteral(new Date(Date.UTC(10_000, 0, 1)))).toThrow(SqlLiteralError);
  });

  it("renders string and number arrays with an explicit type, empty ones too", () => {
    expect(sqlLiteral(["A", "B'C"])).toBe("ARRAY[E'A', E'B''C']::text[]");
    expect(sqlLiteral([])).toBe("ARRAY[]::text[]");
    expect(sqlLiteral([1, -2])).toBe("ARRAY[(1), (-2)]::numeric[]");
  });

  it.each([
    ["a mixed array", ["a", 1]],
    ["a nested array", [["a"]]],
    ["an array with null", ["a", null]],
    ["an array with NaN", [1, NaN]],
    ["an object", { toString: () => "x" }],
    ["undefined", undefined],
    ["a bigint", BigInt(1)],
    ["a function", () => "x"],
    ["a symbol", Symbol("x")],
  ])("refuses %s without quoting it", (_label, value) => {
    expect(() => sqlLiteral(value, "$1")).toThrow(SqlLiteralError);
    try {
      sqlLiteral(value, "$1");
    } catch (err) {
      expect((err as Error).message).toMatch(/^\$1(\[\d+\])?: /);
      expect((err as Error).message).not.toContain("toString");
    }
  });
});

describe("renderSql", () => {
  it("replaces each $n with its parameter, $10 apart from $1", () => {
    const params = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(renderSql("SELECT $1, $10, $2::int", params)).toBe("SELECT (1), (10), (2)::int");
  });

  it("leaves $n inside literals, quoted identifiers and comments alone", () => {
    const text = `SELECT '$1 it''s', "col$1", x ~ '^[0-9]+$' -- $1\n/* $1 */ FROM t WHERE a = $1`;
    expect(renderSql(text, ["v"])).toBe(`SELECT '$1 it''s', "col$1", x ~ '^[0-9]+$' -- $1\n/* $1 */ FROM t WHERE a = E'v'`);
  });

  it("keeps an injected value inside its literal", () => {
    const sql = renderSql("SELECT * FROM t WHERE code = ANY($1::text[]) AND d = CAST($2 AS date)", [
      ["x'); DROP TABLE t; --"],
      "2026-10-14' OR '1'='1",
    ]);
    expect(sql).toBe(
      "SELECT * FROM t WHERE code = ANY(ARRAY[E'x''); DROP TABLE t; --']::text[]::text[]) AND d = CAST(E'2026-10-14'' OR ''1''=''1' AS date)"
    );
  });

  it("refuses a placeholder without a parameter, $0, dollar quoting and unterminated text", () => {
    expect(() => renderSql("SELECT $2", ["a"])).toThrow(/\$2 has no parameter/);
    expect(() => renderSql("SELECT $0", ["a"])).toThrow(SqlLiteralError);
    expect(() => renderSql("SELECT $$x$$", [])).toThrow(/dollar-quoted/);
    expect(() => renderSql("SELECT 'open", [])).toThrow(/unterminated/);
    expect(() => renderSql("SELECT 1 /* open", [])).toThrow(/unterminated/);
  });

  it("renders every goals query with the parameters the refresh binds, leaving no placeholder", async () => {
    const today = "2026-10-14";
    const rendered = [
      renderSql(cutoffsQuery.sql, [today]),
      renderSql(dailyQuery.sql, [today]),
      renderSql(truckloadsQuery.sql, [today, ["CUST1", "CUST2"]]),
      renderSql(revenueByCurrencyQuery.sql, [today]),
      renderSql(shipmentsQuery.sql, [today]),
      renderSql(batchesQuery.sql, [today]),
      renderSql(batchHistoryQuery.sql, [today]),
      renderSql(referencesQuery.sql, [today]),
      renderSql(customersQuery.sql, []),
      renderSql(shipmentLinesQuery.sql, [today]),
      renderSql(forecastOrdersQuery(true).sql, [today]),
      renderSql(forecastAosQuery.sql, [today]),
    ];
    await missingColumns(async (text, params) => {
      rendered.push(renderSql(text, params));
      return [];
    }, SHIPMENT_LINE_COLUMNS);
    for (const sql of rendered) {
      expect(sql).not.toMatch(/\$\d/);
    }
    expect(rendered[0]).toContain("CAST(E'2026-10-14' AS date)");
    expect(rendered[2]).toContain("ANY(ARRAY[E'CUST1', E'CUST2']::text[]::text[])");
  });
});
