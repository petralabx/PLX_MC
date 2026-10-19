// TASK-3167: explainer video. Complex work a person must verify (a high-risk
// change, a procedure of more than 5 steps, or 2 or more systems) needs a short
// video from the plx-knowledge-video skill. A video artifact is mp4 or webm,
// checked against its bytes, up to 100 MiB. The gate warns until 2026-11-01 and
// while uploads are off, then blocks. Simple work is never asked for a video.
import { describe, expect, it } from "vitest";

import type { Evidence, EvidenceArtifact, Task } from "@/lib/mc-data";
import {
  MAX_ARTIFACT_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_EVIDENCE_ENFORCE_FROM,
  artifactProblem,
  complexityReasons,
  hasVideoArtifact,
  hasVisualArtifact,
  procedureSteps,
  sniffContentType,
  verifyCompliance,
  videoEvidenceMode,
  videoNameProblem,
} from "@/lib/compliance";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const MP4 = new Uint8Array([0, 0, 0, 0x20, ...ascii("ftypisom"), 0, 0, 2, 0]);
const MOV = new Uint8Array([0, 0, 0, 0x14, ...ascii("ftypqt  "), 0, 0, 2, 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...ascii("webm")]);
const MKV = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88, ...ascii("matroska")]);

const steps = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}. Open screen ${i + 1}.`).join("\n");

describe("complexityReasons", () => {
  const base = { description: "Fix the label.", repos: ["plx-mc"], evidence: undefined };

  it("finds a high-risk change", () => {
    expect(complexityReasons(base, "high")).toEqual(["high-risk change"]);
    expect(complexityReasons(base, "standard")).toEqual([]);
  });

  it("finds a procedure of more than 5 steps in the description or the evidence summary", () => {
    expect(procedureSteps(steps(6))).toBe(6);
    expect(complexityReasons({ ...base, description: steps(5) })).toEqual([]);
    expect(complexityReasons({ ...base, description: steps(6) })).toEqual(["6-step procedure"]);
    const evidence: Evidence = { summary: `Check it:\n\n${steps(7)}`, items: [] };
    expect(complexityReasons({ ...base, evidence })).toEqual(["7-step procedure"]);
  });

  it("does not count bullets or prose as steps", () => {
    expect(procedureSteps("- one\n- two\n- three\n- four\n- five\n- six\nVersion 2. is out.")).toBe(0);
  });

  it("finds work on 2 or more systems, counting each system once", () => {
    expect(complexityReasons({ ...base, repos: ["plx-mc", "portal-web"] })).toEqual(["2 systems"]);
    expect(complexityReasons({ ...base, repos: ["plx-mc", "PLX-MC", " "] })).toEqual([]);
    expect(complexityReasons({ ...base, repos: [] })).toEqual([]);
  });

  it("lists every reason that applies", () => {
    expect(complexityReasons({ description: steps(8), repos: ["plx-mc", "agentic-swarm", "portal-web"] }, "high")).toEqual([
      "high-risk change",
      "8-step procedure",
      "3 systems",
    ]);
  });
});

describe("video artifacts", () => {
  it("finds mp4 and webm from the bytes, and refuses QuickTime and Matroska", () => {
    expect(sniffContentType(MP4)).toBe("video/mp4");
    expect(sniffContentType(WEBM)).toBe("video/webm");
    expect(sniffContentType(MOV)).toBeNull();
    expect(sniffContentType(MKV)).toBeNull();
  });

  it("accepts a video whose bytes match its type", () => {
    expect(artifactProblem("video", "video/mp4", MP4)).toBeNull();
    expect(artifactProblem("video", "video/webm", WEBM)).toBeNull();
  });

  it("refuses other types, and bytes that are not the declared type", () => {
    expect(artifactProblem("video", "video/quicktime", MOV)).toBe("A video must be video/mp4 or video/webm, not video/quicktime.");
    expect(artifactProblem("video", "video/mp4", WEBM)).toBe("The file content is video/webm, not video/mp4.");
    expect(artifactProblem("screenshot", "video/mp4", MP4)).toMatch(/^A screenshot must be image\/png/);
  });

  it("allows a video up to 100 MiB, and keeps the inline limit for other kinds", () => {
    // Session start: only the declared size. Session finish: the first bytes and the real size.
    expect(artifactProblem("video", "video/mp4", null, MAX_VIDEO_BYTES)).toBeNull();
    expect(artifactProblem("video", "video/mp4", MP4, MAX_VIDEO_BYTES)).toBeNull();
    expect(artifactProblem("video", "video/mp4", null, MAX_VIDEO_BYTES + 1)).toBe(
      `The file has ${MAX_VIDEO_BYTES + 1} bytes. Limit: ${MAX_VIDEO_BYTES}.`
    );
    expect(artifactProblem("video", "video/mp4", null, 0)).toBe("The file is empty.");
    expect(artifactProblem("screenshot", "image/png", null, MAX_ARTIFACT_BYTES + 1)).toMatch(/Limit: 3096576, so the base64 upload fits the 4 MiB MCP limit\.$/);
  });

  it("needs the extension of its type, so SharePoint plays it", () => {
    expect(videoNameProblem("video/mp4", "Explainer.MP4")).toBeNull();
    expect(videoNameProblem("video/webm", "explainer.webm")).toBeNull();
    expect(videoNameProblem("video/mp4", "explainer.mov")).toBe("A video/mp4 video must be named *.mp4.");
  });
});

const artifact = (kind: EvidenceArtifact["kind"]): EvidenceArtifact => ({
  kind, name: "x", caption: "Walkthrough", url: "https://sp/x", driveItemId: kind, contentType: "video/mp4",
  size: 10, sha256: "0".repeat(64), uploadedAt: "2026-10-18T15:00:00.000Z",
});

describe("explainer video at the gate", () => {
  // After the visual-evidence week, so a diagram is always attached to keep that rule quiet.
  const BEFORE = Date.parse("2026-10-28T12:00:00Z");
  const AFTER = Date.parse("2026-11-02T12:00:00Z");
  const evidence = (artifacts: EvidenceArtifact[]): Evidence => ({
    summary: "The flow is in the diagram.",
    items: [{ key: "a", label: "a", done: true }],
    rollback: "Revert the PR.",
    qa: { pass: 1, fail: 0, total: 1, suite: "vitest", ran: "now", tests: [] },
    artifacts,
  });
  const task = (over: Partial<Task>): Task => ({
    id: "TASK-X", title: "t", bucket: "BKT-WMS", stage: "progress", priority: "medium", assignee: "vibes",
    coassignees: [], reporter: "vince", accountableOwner: "greg", reqs: [], repos: ["plx-mc", "portal-web"], estimate: "M",
    labels: ["verify:human"], prs: [], due: "—", sync: { state: "pending", ts: "—", sp: "—" }, subtasks: [], activity: [],
    evidence: evidence([artifact("diagram")]),
    ...over,
  });
  const verify = (t: Task, now: number, evidenceStoreEnabled: boolean, tier: "standard" | "high" = "standard") =>
    verifyCompliance({ task: t, actor: "agent", tier, bucketPrd: "present", now, evidenceStoreEnabled });

  it("blocks only after its week (one week after visual evidence) and only while uploads are on", () => {
    expect(VIDEO_EVIDENCE_ENFORCE_FROM).toBe("2026-11-01T04:00:00.000Z");
    expect(videoEvidenceMode(Date.parse("2026-11-01T03:59:59Z"), true)).toBe("warn");
    expect(videoEvidenceMode(Date.parse(VIDEO_EVIDENCE_ENFORCE_FROM), true)).toBe("block");
    expect(videoEvidenceMode(AFTER, false)).toBe("warn");
  });

  it("warns before the block date for a complex task without a video", () => {
    const r = verify(task({}), BEFORE, true);
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).toMatch(
      /no explainer video: complex change \(2 systems\); make one with the plx-knowledge-video skill .* Warning only until 2026-11-01\./
    );
  });

  it("blocks after the block date and records the reason on the verdict", () => {
    const r = verify(task({}), AFTER, true);
    expect(r.verdict).toBe("block");
    expect(r.reasons).toEqual([expect.stringMatching(/^no explainer video: complex change \(2 systems\); /)]);
  });

  it("warns while uploads are off, even after the block date", () => {
    const r = verify(task({}), AFTER, false);
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).toMatch(/no explainer video: .* Warning only: evidence uploads are off for this task\./);
  });

  it("blocks a high-risk change and a long procedure, naming why", () => {
    const high = verify(task({ repos: ["plx-mc"], labels: [] }), AFTER, true, "high");
    expect(high.verdict).toBe("block");
    expect(high.reasons.join(" ")).toMatch(/no explainer video: complex change \(high-risk change\)/);
    const long = verify(task({ repos: ["plx-mc"], description: steps(6) }), AFTER, true);
    expect(long.reasons.join(" ")).toMatch(/no explainer video: complex change \(6-step procedure\)/);
  });

  it("passes a complex task with a video, and a video is not visual evidence on its own", () => {
    const withVideo = evidence([artifact("diagram"), artifact("video")]);
    expect(verify(task({ evidence: withVideo }), AFTER, true).verdict).toBe("pass");
    expect(hasVideoArtifact(withVideo)).toBe(true);
    expect(hasVisualArtifact(evidence([artifact("video")]))).toBe(false);
  });

  it("leaves simple tasks and work without human verification alone", () => {
    const simple = verify(task({ repos: ["plx-mc"], description: steps(5) }), AFTER, true);
    expect(simple.verdict).toBe("pass");
    expect(simple.reasons.join(" ")).not.toMatch(/explainer video/);
    const unverified = verify(task({ labels: ["kind:code"] }), AFTER, true);
    expect(unverified.verdict).toBe("pass");
    expect(unverified.reasons.join(" ")).not.toMatch(/explainer video/);
  });
});
