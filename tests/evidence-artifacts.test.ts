// TASK-3166: visual evidence. An agent uploads a diagram, annotated screenshot
// or web page for a person to open. The rules are pure: the type must match the
// bytes, the file fits an inline upload, and SharePoint accepts the path. The
// gate warns about a missing artifact until uploads are on and its week ends.
import { describe, expect, it } from "vitest";

import type { Evidence, EvidenceArtifact, Task } from "@/lib/mc-data";
import {
  MAX_ARTIFACT_BYTES,
  PLX_EVIDENCE_STORE,
  VISUAL_EVIDENCE_ENFORCE_FROM,
  artifactFolder,
  artifactProblem,
  hasVisualArtifact,
  ownEvidenceSite,
  sharePointSafeName,
  sniffContentType,
  verifyCompliance,
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

  it("refuses an empty file and one over 3 MiB", () => {
    expect(artifactProblem("screenshot", "image/png", new Uint8Array())).toBe("The file is empty.");
    const big = new Uint8Array(MAX_ARTIFACT_BYTES + 1);
    big.set(PNG);
    expect(artifactProblem("screenshot", "image/png", big)).toMatch(/Limit: 3145728\.$/);
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
    expect(r.reasons.join(" ")).toMatch(/no visual evidence: .* Warning only: evidence uploads are off\./);
  });

  it("warns during the week when uploads are on, then blocks", () => {
    expect(verify(task({ evidence: evidence() }), BEFORE, true).reasons.join(" ")).toMatch(/Warning only until 2026-10-25\./);
    const blocked = verify(task({ evidence: evidence() }), AFTER, true);
    expect(blocked.verdict).toBe("block");
    expect(blocked.reasons[0]).toMatch(/^no visual evidence: upload a diagram, annotated screenshot or web page/);
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
