// POST /api/reporting/goals/import — an Editor previews an Excel import (TASK-2897).
// Body: { fileName, fileBase64 } (≤ 2 MB). Only the "Manual entries" sheet is
// read; a header row that differs from the export's (422 header_mismatch) or
// more than 1,000 entry rows (422 too_many_rows) rejects the file, and any row
// problem rejects it with every row's errors (422 invalid_rows). Otherwise it
// answers with the entries to add, change and remove, each with the status it
// would get, and a token for POST …/import/confirm. Nothing changes here.

import { parseBody, route } from "@/lib/api/route";
import { IMPORT_BODY, previewImport, requireGoalsRole } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async (req) => {
  const actor = await requireGoalsRole("editor");
  const body = await parseBody(req, IMPORT_BODY);
  return previewImport({ fileName: body.fileName, bytes: Buffer.from(body.fileBase64, "base64"), actor });
});
