// Renders a dataset query's $n parameters as SQL literals, for the reporting
// MCP path (source-mcp.ts): plx-reporting-mcp's execute_sql takes SQL text
// only, with no bind parameters (TASK-3489). This is the one place a value
// becomes SQL text, so it accepts only what the goals queries bind, each in
// one strict form, and refuses everything else:
//   string          E'…' with backslash and quote escaped (safe whatever
//                   standard_conforming_strings is); NUL refused
//   number          finite only, parenthesised so a minus can't form a comment
//   boolean / null  TRUE, FALSE, NULL
//   Date            a valid instant, as its UTC ISO string cast to timestamptz
//   array           all strings → ARRAY[…]::text[], all numbers → ARRAY[…]::numeric[]
// Placeholders inside quoted literals, quoted identifiers and comments are left
// alone; a dollar-quoted string is refused. Errors never quote the value.

export class SqlLiteralError extends Error {
  readonly code = "sql_literal";
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function stringLiteral(value: string, at: string): string {
  if (value.includes("\u0000")) throw new SqlLiteralError(`${at}: strings may not contain NUL`);
  return `E'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function numberLiteral(value: number, at: string): string {
  if (!Number.isFinite(value)) throw new SqlLiteralError(`${at}: numbers must be finite`);
  return `(${String(value)})`;
}

/** One parameter as a SQL literal; `at` names it in errors ("$2"). */
export function sqlLiteral(value: unknown, at = "parameter"): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return stringLiteral(value, at);
  if (typeof value === "number") return numberLiteral(value, at);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) {
    const iso = Number.isNaN(value.getTime()) ? "" : value.toISOString();
    if (!ISO_INSTANT.test(iso)) throw new SqlLiteralError(`${at}: invalid date`);
    return `'${iso}'::timestamptz`;
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) {
      return `ARRAY[${value.map((v, i) => stringLiteral(v, `${at}[${i}]`)).join(", ")}]::text[]`;
    }
    if (value.every((v) => typeof v === "number")) {
      return `ARRAY[${value.map((v, i) => numberLiteral(v, `${at}[${i}]`)).join(", ")}]::numeric[]`;
    }
    throw new SqlLiteralError(`${at}: arrays must hold only strings or only numbers`);
  }
  throw new SqlLiteralError(`${at}: unsupported type ${typeof value}`);
}

/** `text` with every $n replaced by sqlLiteral(params[n-1]); a $n without a parameter is refused. */
export function renderSql(text: string, params: readonly unknown[] = []): string {
  let out = "";
  let i = 0;
  const copyUntil = (end: number) => {
    out += text.slice(i, end);
    i = end;
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "'" || ch === '"') {
      // Quoted literal or identifier: a doubled quote stays inside it.
      let j = i + 1;
      for (;;) {
        const close = text.indexOf(ch, j);
        if (close < 0) throw new SqlLiteralError("unterminated quote in query text");
        if (text[close + 1] === ch) j = close + 2;
        else {
          j = close + 1;
          break;
        }
      }
      copyUntil(j);
    } else if (ch === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      copyUntil(end < 0 ? text.length : end);
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new SqlLiteralError("unterminated comment in query text");
      copyUntil(end + 2);
    } else if (ch === "$") {
      const m = /^\$(\d+)/.exec(text.slice(i));
      if (!m) throw new SqlLiteralError("dollar-quoted strings are not supported");
      const n = Number(m[1]);
      if (n < 1 || n > params.length) throw new SqlLiteralError(`$${m[1]} has no parameter`);
      out += sqlLiteral(params[n - 1], `$${n}`);
      i += m[0].length;
    } else {
      copyUntil(i + 1);
    }
  }
  return out;
}
