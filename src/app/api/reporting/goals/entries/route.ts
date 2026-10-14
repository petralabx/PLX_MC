// GET  /api/reporting/goals/entries — the live manual entries, oldest first. Viewers and Editors.
// POST /api/reporting/goals/entries — an Editor adds one (TASK-2897). The body
// holds the entry's fields only; the Entry ID, "entered by" and the source are
// set by Mission Control, and the entry is audited. 201 with the entry.

import { NextResponse } from "next/server";

import { parseBody, route } from "@/lib/api/route";
import { ENTRY_BODY, createEntry, liveEntries, requireGoalsRole } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireGoalsRole("viewer");
  return { entries: await liveEntries() };
});

export const POST = route(async (req) => {
  const actor = await requireGoalsRole("editor");
  const body = await parseBody(req, ENTRY_BODY);
  const entry = await createEntry(body, actor);
  return NextResponse.json({ data: { entry } }, { status: 201 });
});
