// The reporting replica through plx-reporting-mcp (TASK-3489): the same fixed
// dataset queries as source-db.ts, sent to the server's execute_sql tool over
// Streamable HTTP with a bearer token, for hosts that can't reach the replica's
// port 5432 (Vercel). Server-only. What differs from the pg path:
//   - execute_sql takes SQL text only, so parameters become literals in
//     sql-literal.ts, the one place that does it.
//   - The server runs postgres-mcp in restricted mode: each statement is its
//     own read-only transaction, so there is no single REPEATABLE READ snapshot
//     across datasets, and it can't SET a time zone (the queries don't need one).
//   - It caps a result at 5,000 rows and 2 MB, and each statement at 15 s.
// Rows come back as Python's repr of psycopg rows; parsePythonRows reads them
// into what node-postgres would return (numeric as an exact string, integers as
// numbers). A truncated result, a tool or SQL error, an unreadable result, an
// HTTP error or the attempt's time running out fails the attempt: there is no
// partial snapshot. Nothing here logs; errors carry a stable code and a fixed
// message, never the token, the SQL text or row values.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { reportingMcpToken, reportingMcpUrl } from "@/lib/secrets";

import { ATTEMPT_TIMEOUT_MS, AttemptTimeoutError, type SourceQuery } from "./source-db";
import { renderSql } from "./sql-literal";

/** A reporting MCP failure, with a stable code for the run row (refresh.isTransient decides on retries). */
export class ReportingMcpError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const unreadable = () => new ReportingMcpError("mcp_bad_result", "the reporting MCP returned a result that could not be read");

// ── Python repr → node-postgres values ──────────────────────────────────────

/** A Python Decimal's text (possibly 1E-7 or 0E-8) as Postgres prints numeric. */
function decimalText(text: string): string {
  if (/^-?(NaN|Infinity)$/.test(text)) return text;
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/.exec(text);
  if (!m) throw unreadable();
  const [, sign, int, frac = "", exp = "0"] = m;
  let digits = int + frac;
  const scale = frac.length - Number(exp);
  if (scale <= 0) digits += "0".repeat(-scale);
  else digits = digits.padStart(scale + 1, "0");
  const whole = (scale > 0 ? digits.slice(0, -scale) : digits).replace(/^0+(?=\d)/, "");
  return `${sign}${whole}${scale > 0 ? `.${digits.slice(-scale)}` : ""}`;
}

const SIMPLE_ESCAPES: Record<string, string> = { "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t" };

/**
 * Python's repr of the result rows (a list of dicts), read strictly: str, int,
 * float, bool, None, Decimal, list and dict only. Decimal becomes Postgres's
 * numeric text and int a number, as node-postgres returns numeric and int4.
 * Anything else (a date, bytes, an int past 2^53) is refused: every dataset
 * query casts its dates to text.
 */
export function parsePythonRows(text: string): Record<string, unknown>[] {
  let i = 0;
  const ws = () => {
    while (text[i] === " " || text[i] === "\n") i += 1;
  };
  const expect = (s: string) => {
    if (!text.startsWith(s, i)) throw unreadable();
    i += s.length;
  };
  const str = (): string => {
    const quote = text[i];
    i += 1;
    let out = "";
    for (;;) {
      const ch = text[i];
      if (ch === undefined) throw unreadable();
      i += 1;
      if (ch === quote) return out;
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const esc = text[i];
      i += 1;
      if (esc !== undefined && esc in SIMPLE_ESCAPES) {
        out += SIMPLE_ESCAPES[esc];
        continue;
      }
      const width = esc === "x" ? 2 : esc === "u" ? 4 : esc === "U" ? 8 : 0;
      const hex = text.slice(i, i + width);
      if (!width || !new RegExp(`^[0-9a-f]{${width}}$`).test(hex)) throw unreadable();
      const point = parseInt(hex, 16);
      if (point > 0x10ffff) throw unreadable();
      out += String.fromCodePoint(point);
      i += width;
    }
  };
  const seq = <T>(close: string, item: () => T): T[] => {
    const out: T[] = [];
    ws();
    if (text[i] === close) {
      i += 1;
      return out;
    }
    for (;;) {
      out.push(item());
      ws();
      if (text[i] === close) {
        i += 1;
        return out;
      }
      expect(",");
      ws();
    }
  };
  const value = (): unknown => {
    ws();
    const ch = text[i];
    if (ch === "'" || ch === '"') return str();
    if (ch === "[") {
      i += 1;
      return seq("]", value);
    }
    if (ch === "{") {
      i += 1;
      return Object.fromEntries(
        seq("}", () => {
          ws();
          if (text[i] !== "'" && text[i] !== '"') throw unreadable();
          const key = str();
          ws();
          expect(":");
          return [key, value()] as const;
        })
      );
    }
    for (const [word, v] of [["None", null], ["True", true], ["False", false]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    if (text.startsWith("Decimal(", i)) {
      i += "Decimal(".length;
      const inner = text[i] === "'" || text[i] === '"' ? str() : "";
      expect(")");
      return decimalText(inner);
    }
    const m = /^(-?inf|nan|-?\d+(\.\d*)?(e[+-]?\d+)?)/.exec(text.slice(i, i + 40));
    if (!m) throw unreadable();
    i += m[0].length;
    if (m[0] === "nan") return NaN;
    if (m[0].endsWith("inf")) return m[0].startsWith("-") ? -Infinity : Infinity;
    const n = Number(m[0]);
    if (!m[2] && !m[3] && !Number.isSafeInteger(n)) throw unreadable();
    return n;
  };
  const rows = value();
  ws();
  if (i !== text.length || !Array.isArray(rows)) throw unreadable();
  if (!rows.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))) throw unreadable();
  return rows as Record<string, unknown>[];
}

// ── execute_sql results ─────────────────────────────────────────────────────

// postgres-mcp answers a failed statement with a normal text item "Error: …"
// whose text can quote the SQL, so only its kind is kept. Codes that
// refresh.isTransient retries: 57014 (statement timeout or a recovery conflict)
// and 08006 (the server's connection pool was reset or the database dropped).
const SQL_ERRORS: readonly [RegExp, string, string][] = [
  [/statement timeout|canceling statement|timed out/i, "57014", "the reporting MCP cancelled a statement (time limit or replica conflict)"],
  [/pool .*closed|connection attempt failed|has no attribute 'connection'|server closed the connection|terminating connection|could not connect|connection (is )?(lost|closed|refused)/i, "08006", "the reporting MCP lost its database connection"],
  [/permission denied/i, "42501", "the reporting MCP's database role was refused access"],
  [/error validating query|is not allowed|failed to parse/i, "mcp_rejected", "the reporting MCP's restricted mode refused the query"],
];

/** The rows of one execute_sql result (a CallToolResult), or the error that fails the attempt. */
export function executeSqlRows(callResult: object): Record<string, unknown>[] {
  const result = callResult as { isError?: unknown; content?: unknown };
  const items = Array.isArray(result.content) ? (result.content as { type?: unknown; text?: unknown }[]) : [];
  const texts = items.map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text : null));
  if (result.isError === true) throw new ReportingMcpError("mcp_tool_error", "the reporting MCP's execute_sql tool failed");
  if (texts.some((t) => t?.startsWith("[TRUNCATED"))) {
    throw new ReportingMcpError("mcp_truncated", "the reporting MCP truncated a result (5,000 rows or 2 MB); no partial snapshot is kept");
  }
  if (texts.length !== 1 || texts[0] === null) throw unreadable();
  const text = texts[0];
  if (text.startsWith("Error:")) {
    const [, code, message] = SQL_ERRORS.find(([pattern]) => pattern.test(text)) ?? [null, "mcp_sql_error", "the reporting MCP's execute_sql returned an error"];
    throw new ReportingMcpError(code, message);
  }
  return parsePythonRows(text);
}

// ── Transport ───────────────────────────────────────────────────────────────

export interface ReportingMcpOptions {
  url?: string;
  token?: string;
  /** For tests; default the global fetch. */
  fetch?: typeof fetch;
}

/**
 * Run `fn` against plx-reporting-mcp: one MCP session per attempt, its queries
 * one at a time (the server allows 5 open requests per client), within
 * `timeoutMs` in total. The session is ended on the way out.
 */
export async function withReportingMcp<T>(
  fn: (q: SourceQuery) => Promise<T>,
  timeoutMs: number = ATTEMPT_TIMEOUT_MS,
  options: ReportingMcpOptions = {}
): Promise<T> {
  const url = new URL(options.url ?? reportingMcpUrl());
  const authorization = `Bearer ${options.token ?? reportingMcpToken()}`;
  const baseFetch = options.fetch ?? fetch;
  const deadline = Date.now() + timeoutMs;
  const attempt = new AbortController();
  const timer = setTimeout(() => attempt.abort(new AttemptTimeoutError(timeoutMs)), timeoutMs);

  const guardedFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    // No standalone SSE stream: every answer comes on its POST, and an idle
    // GET would hold one of the client's 5 open requests at the gateway.
    if ((init.method ?? "GET").toUpperCase() === "GET") return new Response(null, { status: 405 });
    const headers = new Headers(init.headers);
    headers.set("Authorization", authorization);
    const signal = init.signal ? AbortSignal.any([init.signal, attempt.signal]) : attempt.signal;
    let response: Response;
    try {
      response = await baseFetch(input, { ...init, headers, signal });
    } catch (err) {
      if (attempt.signal.aborted) throw attempt.signal.reason;
      const cause = (err as { cause?: { code?: unknown } })?.cause?.code;
      throw new ReportingMcpError(typeof cause === "string" ? cause : "mcp_network", "the reporting MCP could not be reached");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ReportingMcpError(`mcp_http_${response.status}`, `the reporting MCP answered HTTP ${response.status}`);
    }
    return response;
  };

  const remaining = () => {
    const ms = Math.ceil(deadline - Date.now());
    if (ms <= 0 || attempt.signal.aborted) throw new AttemptTimeoutError(timeoutMs);
    return ms;
  };
  // The SDK's own request timeout is the attempt's time left, reported as the attempt's timeout.
  const timeoutAware = async <R>(work: () => Promise<R>): Promise<R> => {
    try {
      return await work();
    } catch (err) {
      if (attempt.signal.aborted) throw attempt.signal.reason;
      if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) throw new AttemptTimeoutError(timeoutMs);
      throw err;
    }
  };

  const transport = new StreamableHTTPClientTransport(url, { fetch: guardedFetch });
  const client = new Client({ name: "plx-mc-goals-report", version: "1.0.0" });
  try {
    await timeoutAware(() => client.connect(transport, { timeout: remaining(), signal: attempt.signal }));
    const q: SourceQuery = async <R extends object>(text: string, params: unknown[] = []) => {
      const sql = renderSql(text, params);
      const result = await timeoutAware(() =>
        client.callTool({ name: "execute_sql", arguments: { sql } }, undefined, { timeout: remaining(), signal: attempt.signal })
      );
      return executeSqlRows(result) as R[];
    };
    return await fn(q);
  } finally {
    clearTimeout(timer);
    // Best effort: a failed DELETE leaves the session to the server.
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}
