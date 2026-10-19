// TASK-3166: visual evidence. An agent uploads a diagram, annotated screenshot
// or web page for a person to open. The rules are pure: the type must match the
// bytes, the file fits an inline upload, and SharePoint accepts the path. The
// gate warns about a missing artifact until uploads are on and its week ends.
import { describe, expect, it } from "vitest";

import type { Evidence, EvidenceArtifact, Task } from "@/lib/mc-data";
import {
  MAX_ARTIFACT_BYTES,
  MAX_VIDEO_BYTES,
  MCP_ENVELOPE_RESERVE_BYTES,
  MCP_TRANSPORT_LIMIT_BYTES,
  PLX_EVIDENCE_STORE,
  VISUAL_EVIDENCE_ENFORCE_FROM,
  artifactFolder,
  artifactProblem,
  evidenceCompleteForTier,
  hasArtifactKind,
  hasVisualArtifact,
  isComplexWork,
  ownEvidenceSite,
  sharePointSafeName,
  sniffContentType,
  verifyCompliance,
  videoScriptProblem,
  videoUploadProblem,
  visualEvidenceMode,
} from "@/lib/compliance";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const text = (s: string) => new TextEncoder().encode(s);
const SVG = text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const HTML = text("<!DOCTYPE html><html><body>Flow</body></html>");

describe("sniffContentType", () => {
  it("finds each accepted type from the bytes", () => {
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(WEBP)).toBe("image/webp");
    expect(sniffContentType(SVG)).toBe("image/svg+xml");
    expect(sniffContentType(HTML)).toBe("text/html");
  });

  it("reads a web page with an inline SVG diagram as HTML", () => {
    expect(sniffContentType(text('<!DOCTYPE html><html><body><svg width="10"><rect/></svg></body></html>'))).toBe("text/html");
  });

  it("rejects other text and binary data", () => {
    expect(sniffContentType(text("plain notes, no markup"))).toBeNull();
    expect(sniffContentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1]))).toBeNull();
  });
});

describe("artifactProblem", () => {
  it("accepts a file whose bytes match its kind and content type", () => {
    expect(artifactProblem("diagram", "image/svg+xml", SVG)).toBeNull();
    expect(artifactProblem("diagram", "image/png", PNG)).toBeNull();
    expect(artifactProblem("screenshot", "image/webp", WEBP)).toBeNull();
    expect(artifactProblem("web-page", "text/html", HTML)).toBeNull();
  });

  it("refuses a content type the kind does not take", () => {
    expect(artifactProblem("web-page", "image/png", PNG)).toBe("A web-page must be text/html, not image/png.");
    expect(artifactProblem("screenshot", "image/svg+xml", SVG)).toMatch(/^A screenshot must be image\/png or/);
  });

  it("refuses bytes that are not the declared type", () => {
    expect(artifactProblem("diagram", "image/svg+xml", PNG)).toBe("The file content is image/png, not image/svg+xml.");
    expect(artifactProblem("screenshot", "image/png", text("hello"))).toBe("The file content is not an accepted type, not image/png.");
  });

  it("refuses an empty file and one over the cap", () => {
    expect(artifactProblem("screenshot", "image/png", new Uint8Array())).toBe("The file is empty.");
    const big = new Uint8Array(MAX_ARTIFACT_BYTES + 1);
    big.set(PNG);
    expect(artifactProblem("screenshot", "image/png", big)).toBe(
      `The file has ${MAX_ARTIFACT_BYTES + 1} bytes. Limit: 3096576, so the base64 upload fits the 4 MiB MCP limit.`
    );
  });

  it("caps the raw size so the base64 body plus the envelope stays under 4 MiB", () => {
    expect(MAX_ARTIFACT_BYTES).toBe(3096576);
    const encoded = Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4;
    expect(encoded + MCP_ENVELOPE_RESERVE_BYTES).toBeLessThanOrEqual(MCP_TRANSPORT_LIMIT_BYTES);
    // The old 3 MiB cap encoded to exactly 4 MiB, leaving no room for the envelope.
    expect(Math.ceil((3 * 1024 * 1024) / 3) * 4 + MCP_ENVELOPE_RESERVE_BYTES).toBeGreaterThan(MCP_TRANSPORT_LIMIT_BYTES);
    const atCap = new Uint8Array(MAX_ARTIFACT_BYTES);
    atCap.set(PNG);
    expect(artifactProblem("screenshot", "image/png", atCap)).toBeNull();
  });
});

describe("SharePoint paths", () => {
  it("removes the characters SharePoint refuses, and edge dots and spaces", () => {
    expect(sharePointSafeName(' a:b*c?"d<e>f|g#h%i/j\\k ')).toBe("a-b-c--d-e-f-g-h-i-j-k");
    expect(sharePointSafeName("..")).toBe("unnamed");
  });

  it("sends Trading Lab evidence to its own site, and PLX work to the PLX site", () => {
    expect(PLX_EVIDENCE_STORE).toEqual({ site: "/sites/PLXSite", library: "Mission Control" });
    expect(ownEvidenceSite("petralabx/agentic-swarm")).toBe("Trading Lab");
    expect(ownEvidenceSite("PetraLabX/Agentic-Swarm")).toBe("Trading Lab");
    expect(ownEvidenceSite("petralabx/PLX_MC")).toBeNull();
  });

  it("builds <system>/<project>/<bucket>/<task id>", () => {
    expect(artifactFolder({ system: "PLX Mission Control", project: "PRJ-PLX-MC-FRONTIER", bucket: "BKT-HUMAN", taskId: "TASK-3166" })).toBe(
      "PLX Mission Control/PRJ-PLX-MC-FRONTIER/BKT-HUMAN/TASK-3166"
    );
    expect(artifactFolder({ system: "PLX Customer Portal", project: null, bucket: "BKT-OPS", taskId: "TASK-1" })).toBe(
      "PLX Customer Portal/No project/BKT-OPS/TASK-1"
    );
  });
});

const artifact = (kind: EvidenceArtifact["kind"]): EvidenceArtifact => ({
  kind, name: "x", caption: "Flow", url: "https://sp/x", driveItemId: "d1", contentType: "image/png",
  size: 10, sha256: "0".repeat(64), uploadedAt: "2026-10-17T15:00:00.000Z",
});

describe("visual evidence at the gate", () => {
  const BEFORE = Date.parse("2026-10-20T12:00:00Z");
  const AFTER = Date.parse("2026-10-26T12:00:00Z");
  const evidence = (artifacts?: EvidenceArtifact[]): Evidence => ({
    summary: "The flow is in the diagram.",
    items: [{ key: "a", label: "a", done: true }],
    rollback: "Revert the PR.",
    qa: { pass: 1, fail: 0, total: 1, suite: "vitest", ran: "now", tests: [] },
    ...(artifacts ? { artifacts } : {}),
  });
  const task = (over: Partial<Task>): Task => ({
    id: "TASK-X", title: "t", bucket: "BKT-WMS", stage: "progress", priority: "medium", assignee: "vibes",
    coassignees: [], reporter: "vince", accountableOwner: "greg", reqs: [], repos: [], estimate: "M",
    labels: ["verify:human"], prs: [], due: "—", sync: { state: "pending", ts: "—", sp: "—" }, subtasks: [], activity: [],
    ...over,
  });
  const verify = (t: Task, now: number, evidenceStoreEnabled: boolean) =>
    verifyCompliance({ task: t, actor: "agent", tier: "standard", bucketPrd: "present", now, evidenceStoreEnabled });

  it("blocks only after its week and only while uploads are on", () => {
    expect(VISUAL_EVIDENCE_ENFORCE_FROM).toBe("2026-10-25T04:00:00.000Z");
    expect(visualEvidenceMode(AFTER, true)).toBe("block");
    expect(visualEvidenceMode(BEFORE, true)).toBe("warn");
    expect(visualEvidenceMode(AFTER, false)).toBe("warn");
  });

  it("warns while uploads are off, even after the week", () => {
    const r = verify(task({ evidence: evidence() }), AFTER, false);
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).toMatch(/no visual evidence: .* Warning only: evidence uploads are off for this task\./);
  });

  it("warns during the week when uploads are on, then blocks", () => {
    expect(verify(task({ evidence: evidence() }), BEFORE, true).reasons.join(" ")).toMatch(/Warning only until 2026-10-25\./);
    const blocked = verify(task({ evidence: evidence() }), AFTER, true);
    expect(blocked.verdict).toBe("block");
    expect(blocked.reasons[0]).toMatch(/^no visual evidence: upload a diagram, annotated screenshot or web page/);
  });

  it("counts an uploaded screenshot as full-tier proof, and a diagram alone not", () => {
    const noProof = { ...evidence(), qa: undefined };
    expect(evidenceCompleteForTier(noProof, "high").missing.join(" ")).toMatch(/upload a screenshot with mc_upload_evidence/);
    expect(evidenceCompleteForTier({ ...noProof, artifacts: [artifact("diagram")] }, "high").ok).toBe(false);
    expect(evidenceCompleteForTier({ ...noProof, artifacts: [artifact("screenshot")] }, "high").ok).toBe(true);
  });

  it("passes with any visual artifact, and leaves work without human verification alone", () => {
    expect(verify(task({ evidence: evidence([artifact("web-page")]) }), AFTER, true).verdict).toBe("pass");
    expect(hasVisualArtifact(evidence([artifact("screenshot")]))).toBe(true);
    expect(hasVisualArtifact(evidence([]))).toBe(false);
    const plain = verify(task({ labels: ["kind:code"], evidence: evidence() }), AFTER, true);
    expect(plain.verdict).toBe("pass");
    expect(plain.reasons.join(" ")).not.toMatch(/visual evidence/);
  });
});

// TASK-3167: complex work a person must verify also needs an explainer video. The
// agent uploads a plx-knowledge-video script; an operator records and uploads the
// MP4 in chunks. The gate only warns about a missing video for now.
const MP4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
const script = (beats: unknown) => text(JSON.stringify({ voice: "v", beats }));
const BEATS = [
  { slug: "01-map", image: "slides/map.png", narration: "The upload flow has three parts." },
  { slug: "02-ui", url: "/tasks/TASK-1", narration: "The task page shows the files." },
];

describe("explainer video rules (TASK-3167)", () => {
  it("finds an MP4 and a JSON script from the bytes", () => {
    expect(sniffContentType(MP4)).toBe("video/mp4");
    // HEIC images and QuickTime movies also start with an ftyp box.
    const brand = (b: string) => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...[...b].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
    expect(sniffContentType(brand("heic"))).toBeNull();
    expect(sniffContentType(brand("qt  "))).toBeNull();
    expect(sniffContentType(brand("mp42"))).toBe("video/mp4");
    expect(sniffContentType(script(BEATS))).toBe("application/json");
    expect(sniffContentType(script([{ slug: "a", image: "x.png", narration: "An <svg> diagram." }]))).toBe("application/json");
  });

  it("accepts a script whose beats each have a slug, narration, and a url or an image", () => {
    expect(videoScriptProblem(script(BEATS))).toBeNull();
    expect(artifactProblem("video-script", "application/json", script(BEATS))).toBeNull();
  });

  it("refuses a script a recorder cannot use", () => {
    expect(videoScriptProblem(text("{ nope"))).toBe("The video script is not valid JSON.");
    expect(videoScriptProblem(script([]))).toBe("The video script needs a non-empty beats list.");
    expect(videoScriptProblem(script([{ slug: "Bad Slug", image: "a.png", narration: "x" }]))).toMatch(/^Beat 1 needs a lowercase slug/);
    expect(videoScriptProblem(script([BEATS[0], BEATS[0]]))).toBe("Beat 2 repeats the slug 01-map.");
    expect(videoScriptProblem(script([{ slug: "a", image: "a.png", narration: " " }]))).toBe("Beat 1 needs narration text.");
    expect(videoScriptProblem(script([{ slug: "a", url: "/x", image: "a.png", narration: "x" }]))).toBe("Beat 1 needs a page url or an image, not both.");
    expect(videoScriptProblem(script([{ slug: "a", narration: "x" }]))).toBe("Beat 1 needs a page url or an image, not both.");
  });

  it("keeps a script's pages inside the app and its images inside the demos folder", () => {
    const beat = (over: Record<string, string>) => script([{ slug: "a", narration: "x", ...over }]);
    expect(videoScriptProblem(beat({ url: "/tasks/TASK-1?tab=evidence" }))).toBeNull();
    expect(videoScriptProblem(beat({ image: "slides/sub dir/flow.JPG" }))).toBeNull();
    for (const url of ["//evil.example/x", "@evil.example/", "https://evil.example/", "/a b", "/a\\b"]) {
      expect(videoScriptProblem(beat({ url }))).toMatch(/^Beat 1 url must be a path in the app/);
    }
    for (const image of ["../secret.png", "slides/../../x.png", "/etc/x.png", "C:/x.png", "C:\\x.png", "slides\\x.png", "x.gif", ".."]) {
      expect(videoScriptProblem(beat({ image }))).toMatch(/^Beat 1 image must be a PNG, JPEG or WebP path inside the demos folder/);
    }
  });

  it("sends a video through an upload session, never the inline upload", () => {
    expect(artifactProblem("video", "video/mp4", MP4)).toMatch(/^A video goes up in chunks: call mc_start_evidence_upload/);
    expect(videoUploadProblem("video/mp4", 5_000_000)).toBeNull();
    expect(videoUploadProblem("video/webm", 10)).toBe("A video must be video/mp4, not video/webm.");
    expect(videoUploadProblem("video/mp4", 0)).toBe("The video is empty.");
    expect(videoUploadProblem("video/mp4", MAX_VIDEO_BYTES + 1)).toMatch(/Limit: 209715200\.$/);
  });

  it("counts a video as visual evidence, and a script not", () => {
    expect(hasVisualArtifact({ artifacts: [artifact("video")] })).toBe(true);
    expect(hasVisualArtifact({ artifacts: [artifact("video-script")] })).toBe(false);
    expect(hasArtifactKind({ artifacts: [artifact("video-script")] }, "video-script")).toBe(true);
  });

  it("calls work complex when it is high risk, has more than 5 steps, or touches 2 systems", () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}. Do step ${i + 1}.`).join("\n");
    expect(isComplexWork({ description: "One step." }, "high")).toBe(true);
    expect(isComplexWork({ description: steps(6) }, "standard")).toBe(true);
    expect(isComplexWork({ description: steps(5) }, "standard")).toBe(false);
    expect(isComplexWork({ description: "```\n" + steps(9) + "\n```" }, "standard")).toBe(false);
    expect(isComplexWork({ repos: ["portal-web", "plx-mc"] }, "standard")).toBe(true);
    expect(isComplexWork({ repos: ["plx-mc", "plx-mc"] }, "standard")).toBe(false);
    expect(isComplexWork({ repos: ["PLX-MC", "plx-mc "] }, "standard")).toBe(false);
    expect(isComplexWork({ description: `${steps(3)}\n\nThen:\n\n${steps(3)}` }, "standard")).toBe(false);
  });
});

describe("explainer video at the gate (TASK-3167)", () => {
  const AFTER = Date.parse("2026-10-26T12:00:00Z");
  const evidence = (artifacts: EvidenceArtifact[]): Evidence => ({
    summary: "The flow is in the video.",
    items: [{ key: "a", label: "a", done: true }],
    rollback: "Revert the PR.",
    qa: { pass: 1, fail: 0, total: 1, suite: "vitest", ran: "now", tests: [] },
    artifacts,
  });
  const task = (over: Partial<Task>): Task => ({
    id: "TASK-X", title: "t", bucket: "BKT-WMS", stage: "progress", priority: "medium", assignee: "vibes",
    coassignees: [], reporter: "vince", accountableOwner: "greg", reqs: [], repos: ["portal-web", "plx-mc"], estimate: "M",
    labels: ["verify:human"], prs: [], due: "—", sync: { state: "pending", ts: "—", sp: "—" }, subtasks: [], activity: [],
    ...over,
  });
  const verify = (t: Task) => verifyCompliance({ task: t, actor: "agent", tier: "standard", bucketPrd: "present", now: AFTER, evidenceStoreEnabled: true });
  const reasons = (t: Task) => verify(t).reasons.join(" ");

  it("warns, never blocks, when complex work has no video", () => {
    const r = verify(task({ evidence: evidence([artifact("diagram")]) }));
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).toMatch(/no explainer video: complex work needs one\. Upload a plx-knowledge-video script .* Warning only\./);
  });

  it("says the video is pending once the script is uploaded", () => {
    expect(reasons(task({ evidence: evidence([artifact("diagram"), artifact("video-script")]) }))).toMatch(
      /explainer video pending: the video script is uploaded\. An operator records it/
    );
  });

  it("is quiet with a video, and for work that is not complex", () => {
    expect(reasons(task({ evidence: evidence([artifact("video")]) }))).not.toMatch(/explainer video/);
    expect(reasons(task({ repos: ["plx-mc"], evidence: evidence([artifact("diagram")]) }))).not.toMatch(/explainer video/);
  });
});
