// The MCP side of the human-verification evidence standard (TASK-3165): agent
// text on work a person must verify. During the warn-only week the report goes
// back in the result; after it, blocking findings refuse the call with a 400.
import { ApiError } from "@/lib/api/route";
import { blockingFindings, describeFindings, type EvidenceStandardReport } from "@/lib/compliance";

export function assertEvidenceStandard(what: string, report: EvidenceStandardReport): void {
  const blocking = blockingFindings(report);
  if (blocking.length === 0) return;
  throw new ApiError(
    "evidence_standard",
    `${what} breaks STE-lite, which applies to work a person must verify: ${describeFindings(blocking)} ` +
      "Fix: one instruction per sentence, 20 words or fewer per sentence in a step, 25 per other sentence, 6 sentences per paragraph.",
    400
  );
}
