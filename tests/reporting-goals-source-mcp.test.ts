// The reporting MCP source adapter (TASK-3489) against a fake plx-reporting-mcp:
// a local Streamable HTTP MCP server with a bearer check in front, whose
// execute_sql answers the way the real one does (Python's repr of the rows, an
// "Error: …" text, a [TRUNCATED …] notice). Covers success, truncation, tool
// and SQL errors, 401, 429, 5xx and the attempt timeout, and that nothing is
// logged and no error carries the token, the SQL text or row values.

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { isTransient } from "@/lib/reporting/goals/refresh";
import { AttemptTimeoutError } from "@/lib/reporting/goals/source-db";
import { executeSqlRows, parsePythonRows, ReportingMcpError, withReportingMcp } from "@/lib/reporting/goals/source-mcp";

const TOKEN = "test-token-not-a-secret-3489";
const SECRET_SQL_MARKER = "secret_marker_table";

const fake = {
  status: 0,
  calls: [] as string[],
  methods: [] as string[],
  closed: [] as string[],
  answer: (async () => ({ content: [{ type: "text", text: "[]" }] })) as (sql: string) => Promise<CallToolResult>,
};

let http: HttpServer;
let url = "";

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

beforeAll(async () => {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  http = createServer(async (req, res) => {
    fake.methods.push(req.method ?? "");
    if (fake.status) {
      res.writeHead(fake.status, { "Retry-After": "1", "Content-Type": "text/plain" });
      res.end(`gateway says no ${TOKEN}`);
      return;
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const sid = req.headers["mcp-session-id"];
    let transport = typeof sid === "string" ? sessions.get(sid) : undefined;
    if (!transport) {
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => void sessions.set(id, created),
        onsessionclosed: (id) => {
          sessions.delete(id);
          fake.closed.push(id);
        },
      });
      const server = new Server({ name: "fake-reporting-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const sql = String(request.params.arguments?.sql ?? "");
        fake.calls.push(sql);
        return fake.answer(sql);
      });
      await server.connect(created);
      transport = created;
    }
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address() as { port: number };
  url = `http://127.0.0.1:${address.port}/mcp`;
});

afterAll(async () => {
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

const logs = { spies: [] as ReturnType<typeof vi.spyOn>[] };
beforeEach(() => {
  fake.status = 0;
  fake.calls = [];
  fake.methods = [];
  fake.closed = [];
  fake.answer = async () => ({ content: [{ type: "text", text: "[]" }] });
  logs.spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => {
  // The adapter itself never logs.
  for (const spy of logs.spies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });

async function failure(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as Error & { code?: string };
  }
  throw new Error("expected a failure");
}

function expectClean(err: Error) {
  expect(err.message).not.toContain(TOKEN);
  expect(err.message).not.toContain(SECRET_SQL_MARKER);
  expect(err.message).not.toContain("SELECT");
}

const QUERY = `SELECT * FROM ${SECRET_SQL_MARKER} WHERE d = CAST($1 AS date) AND code = ANY($2::text[])`;

describe("withReportingMcp", () => {
  it("runs each query through execute_sql with literals and the bearer token, and reads the rows as node-postgres would", async () => {
    fake.answer = async () =>
      text(
        "[{'kg': Decimal('5000.000'), 'n': 3, 'ok': True, 'none': None, 'day': '2026-10-14', 'tiny': Decimal('0E-8'), " +
          "'codes': ['A', \"B'C\"], 'name': 'Caf\\xe9 \\\\ \"q\"'}]"
      );
    const rows = await withReportingMcp((q) => q(QUERY, ["2026-10-14", ["A", "B'C"]]), 5_000, { url, token: TOKEN });
    expect(rows).toEqual([
      { kg: "5000.000", n: 3, ok: true, none: null, day: "2026-10-14", tiny: "0.00000000", codes: ["A", "B'C"], name: 'Café \\ "q"' },
    ]);
    expect(fake.calls).toEqual([
      `SELECT * FROM ${SECRET_SQL_MARKER} WHERE d = CAST(E'2026-10-14' AS date) AND code = ANY(ARRAY[E'A', E'B''C']::text[]::text[])`,
    ]);
    // No standalone GET stream; the session is ended with DELETE.
    expect(fake.methods).not.toContain("GET");
    expect(fake.methods.at(-1)).toBe("DELETE");
    expect(fake.closed).toHaveLength(1);
  });

  it("runs the queries one at a time in one session", async () => {
    fake.answer = async (sql) => text(`[{'n': ${sql.length}}]`);
    const out = await withReportingMcp(async (q) => [await q("SELECT 1"), await q("SELECT 22")], 5_000, { url, token: TOKEN });
    expect(out).toEqual([[{ n: 8 }], [{ n: 9 }]]);
    expect(fake.closed).toHaveLength(1);
  });

  it("fails the attempt on a truncated result", async () => {
    fake.answer = async () => ({
      content: [
        { type: "text", text: "[{'n': 1}]" },
        { type: "text", text: "[TRUNCATED: returned 5000 of 12810 rows (row cap 5000). Limits: 5000 rows, 2 MB per result.]" },
      ],
    });
    const err = await failure(withReportingMcp((q) => q(QUERY, ["2026-10-14", []]), 5_000, { url, token: TOKEN }));
    expect(err).toBeInstanceOf(ReportingMcpError);
    expect(err.code).toBe("mcp_truncated");
    expect(isTransient(err)).toBe(false);
    expectClean(err);
  });

  it("fails the attempt on a tool error", async () => {
    fake.answer = async () => ({ isError: true, content: [{ type: "text", text: `boom in ${SECRET_SQL_MARKER}` }] });
    const err = await failure(withReportingMcp((q) => q(QUERY, ["2026-10-14", []]), 5_000, { url, token: TOKEN }));
    expect(err.code).toBe("mcp_tool_error");
    expect(isTransient(err)).toBe(false);
    expectClean(err);
  });

  it("fails on an SQL error without passing on its text (it can quote the SQL)", async () => {
    fake.answer = async (sql) => text(`Error: Error validating query: ${sql}`);
    const rejected = await failure(withReportingMcp((q) => q(QUERY, ["2026-10-14", []]), 5_000, { url, token: TOKEN }));
    expect(rejected.code).toBe("mcp_rejected");
    expectClean(rejected);

    fake.answer = async () => text(`Error: permission denied for table ${SECRET_SQL_MARKER}`);
    const denied = await failure(withReportingMcp((q) => q("SELECT 1"), 5_000, { url, token: TOKEN }));
    expect(denied.code).toBe("42501");
    expect(isTransient(denied)).toBe(false);
    expectClean(denied);

    fake.answer = async () => text("Error: canceling statement due to statement timeout");
    const slow = await failure(withReportingMcp((q) => q("SELECT 1"), 5_000, { url, token: TOKEN }));
    expect(slow.code).toBe("57014");
    expect(isTransient(slow)).toBe(true);

    fake.answer = async () => text("Error: Connection attempt failed: the pool 'pool-2' is closed");
    const pool = await failure(withReportingMcp((q) => q("SELECT 1"), 5_000, { url, token: TOKEN }));
    expect(pool.code).toBe("08006");
    expect(isTransient(pool)).toBe(true);
  });

  it("fails on 401 (not retried) without the token in the error", async () => {
    const err = await failure(withReportingMcp((q) => q("SELECT 1"), 5_000, { url, token: "wrong-token" }));
    expect(err.code).toBe("mcp_http_401");
    expect(isTransient(err)).toBe(false);
    expect(err.message).not.toContain("wrong-token");
    expect(fake.calls).toEqual([]);
  });

  it("fails on 429 and 5xx, which the refresh retries", async () => {
    fake.status = 429;
    const limited = await failure(withReportingMcp((q) => q("SELECT 1"), 5_000, { url, token: TOKEN }));
    expect(limited.code).toBe("mcp_http_429");
    expect(isTransient(limited)).toBe(true);
    expectClean(limited);

    fake.status = 502;
    const down = await failure(withReportingMcp((q) => q("SELECT 1"), 5_000, { url, token: TOKEN }));
    expect(down.code).toBe("mcp_http_502");
    expect(isTransient(down)).toBe(true);
    expectClean(down);
  });

  it("fails as the attempt's timeout when the attempt runs out of time", async () => {
    fake.answer = () => new Promise(() => {});
    const started = Date.now();
    const err = await failure(withReportingMcp((q) => q("SELECT 1"), 300, { url, token: TOKEN }));
    expect(err).toBeInstanceOf(AttemptTimeoutError);
    expect(err.code).toBe("57014");
    expect(isTransient(err)).toBe(true);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("fails when the server can't be reached", async () => {
    const err = await failure(withReportingMcp((q) => q("SELECT 1"), 5_000, { url: "http://127.0.0.1:1/mcp", token: TOKEN }));
    expect(err).toBeInstanceOf(ReportingMcpError);
    expect(isTransient(err)).toBe(true);
  });
});

describe("parsePythonRows", () => {
  it("reads Python's repr of psycopg rows", () => {
    expect(parsePythonRows("[]")).toEqual([]);
    expect(
      parsePythonRows(
        "[{'a': -12, 'b': 1.5, 'c': 1e-05, 'd': Decimal('-1.2E+3'), 'e': Decimal('1E-7'), 'f': Decimal('NaN'), 'g': [], 'h': {'x': [1, None]}}, {'a': 0}]"
      )
    ).toEqual([{ a: -12, b: 1.5, c: 1e-5, d: "-1200", e: "0.0000001", f: "NaN", g: [], h: { x: [1, null] } }, { a: 0 }]);
  });

  it("reads every string escape Python's repr writes", () => {
    expect(parsePythonRows(`[{'s': 'it\\'s \\\\ \\n\\r\\t \\x00 \\u200b \\U0001f600 😀 •'}]`)).toEqual([
      { s: "it's \\ \n\r\t \u0000 ​ 😀 😀 •" },
    ]);
    expect(parsePythonRows(`[{'s': "it's"}]`)).toEqual([{ s: "it's" }]);
  });

  it.each([
    ["a date", "[{'d': datetime.date(2026, 10, 14)}]"],
    ["bytes", "[{'b': b'x'}]"],
    ["an int past 2^53", "[{'n': 12345678901234567890}]"],
    ["trailing text", "[{'n': 1}] extra"],
    ["not a list of dicts", "[1, 2]"],
    ["an unknown escape", "[{'s': '\\q'}]"],
    ["an unterminated string", "[{'s': 'abc}]"],
    ["No results", "No results"],
  ])("refuses %s", (_label, input) => {
    expect(() => parsePythonRows(input)).toThrow(ReportingMcpError);
  });
});

describe("executeSqlRows", () => {
  it("refuses a result with no text or more than one data item", () => {
    expect(() => executeSqlRows({ content: [] })).toThrow(/could not be read/);
    expect(() => executeSqlRows({ content: [{ type: "text", text: "[]" }, { type: "text", text: "[]" }] })).toThrow(/could not be read/);
    expect(() => executeSqlRows({ content: [{ type: "image", data: "", mimeType: "image/png" }] })).toThrow(/could not be read/);
  });
});
