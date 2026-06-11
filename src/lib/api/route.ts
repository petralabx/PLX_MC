// The one shared API route wrapper (governance: no ad hoc handler
// boilerplate). Every route handler goes through `route()`, which enforces
// the standard envelope: { data } on success, { error: { code, message } }
// on failure. Mutating routes validate bodies with zod via `parseBody`.
// Server-side only — the client counterpart is src/lib/api (index.ts).

import { NextResponse } from "next/server";
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

type RouteContext = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: RouteContext) => Promise<unknown>;

export function route(handler: Handler) {
  return async (req: Request, ctx: RouteContext): Promise<NextResponse> => {
    try {
      const data = await handler(req, ctx);
      return NextResponse.json({ data });
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status }
        );
      }
      console.error("[api] unhandled error:", err);
      return NextResponse.json(
        { error: { code: "internal", message: "Internal error." } },
        { status: 500 }
      );
    }
  };
}

export async function parseBody<Schema extends z.ZodType>(
  req: Request,
  schema: Schema
): Promise<z.infer<Schema>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError("invalid_json", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError("invalid_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
