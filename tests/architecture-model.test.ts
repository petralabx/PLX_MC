import { describe, expect, it } from "vitest";

import {
  ArchitectureModelSchema,
  buildArchitectureModel,
  loadSourceMapJson,
} from "@/lib/architecture";
import * as modelRoute from "@/app/api/architecture/model/route";

function validModel() {
  const source = {
    path: "AGENTS.md",
    href: "https://github.com/petralabx/PLX_MC/blob/abc123/AGENTS.md#L1-L2",
    authorityClass: "canonical_architecture",
    commit: "abc123",
    startLine: 1,
    endLine: 2,
  };
  const claim = {
    factId: "node-a",
    claim: "Node A",
    summary: "A canonical summary.",
    sources: [source],
  };

  return {
    schemaVersion: "plx-architecture-model/v1",
    meta: {
      title: "PLX Mission Control",
      kicker: "System architecture · C4",
      subtitle: "Read-only projection of maintained architecture sources.",
      source: {
        path: "docs/architecture/source-map.json",
        schemaVersion: "plx-architecture-source-map/v3",
        commit: "abc123",
        notice: "Generated guide — not official.",
        repositoryUrl: "https://github.com/petralabx/PLX_MC",
      },
      footer: {
        left: ["Generated guide — not official."],
        right: ["Source: docs/architecture/source-map.json"],
      },
    },
    levels: [{ id: "context", label: "Context", title: "System context" }],
    categories: [
      {
        id: "internal",
        label: "Internal",
        colorToken: "--p-ink",
        accent: "left",
        dashed: false,
      },
    ],
    views: [
      {
        id: "context",
        groups: [
          {
            id: "missionControlBoundary",
            label: "Mission Control",
            band: 1,
            tone: "warm",
            nodeIds: ["a", "b"],
          },
        ],
        nodes: [
          {
            id: "a",
            label: "A",
            category: "internal",
            group: "missionControlBoundary",
            band: 1,
            layer: 0,
            description: "A canonical summary.",
            claims: [claim],
          },
          {
            id: "b",
            label: "B",
            category: "internal",
            group: "missionControlBoundary",
            band: 1,
            layer: 0,
            description: "A canonical summary.",
            claims: [{ ...claim, factId: "node-b", claim: "Node B" }],
          },
        ],
        edges: [
          {
            id: "a__b",
            from: "a",
            to: "b",
            label: "calls",
            category: "internal",
            claims: [{ ...claim, factId: "edge-a-b", claim: "A calls B" }],
          },
        ],
      },
    ],
  };
}

function messages(value: unknown): string[] {
  const result = ArchitectureModelSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("ArchitectureModel validation", () => {
  it("accepts a valid model", () => {
    expect(ArchitectureModelSchema.safeParse(validModel()).success).toBe(true);
  });

  it("rejects duplicate node and edge IDs", () => {
    const model = validModel();
    const view = model.views[0];
    view.nodes.push({ ...view.nodes[0] });
    view.edges.push({ ...view.edges[0] });

    expect(messages(model)).toEqual(
      expect.arrayContaining([
        'Duplicate node id "a" in view "context".',
        'Duplicate edge id "a__b" in view "context".',
      ])
    );
  });

  it("rejects dangling edge references", () => {
    const model = validModel();
    model.views[0].edges[0].to = "missing";

    expect(messages(model)).toContain(
      'Edge "a__b" in view "context" references unknown target node "missing".'
    );
  });

  it("rejects unknown and overlapping boundary members", () => {
    const model = validModel();
    const view = model.views[0];
    view.groups.push({
      id: "externalBoundary",
      label: "External",
      band: 2,
      tone: "cool",
      nodeIds: ["a", "missing"],
    });

    expect(messages(model)).toEqual(
      expect.arrayContaining([
        'Group "externalBoundary" in view "context" references unknown node "missing".',
        'Node "a" in view "context" belongs to multiple groups.',
      ])
    );
  });

  it("rejects missing provenance source links", () => {
    const model = validModel();
    model.views[0].nodes[0].claims[0].sources = [];

    expect(messages(model)).toContain(
      'Claim "node-a" on node "a" in view "context" has no source links.'
    );
  });

  it("rejects entities without provenance claims", () => {
    const model = validModel();
    model.views[0].edges[0].claims = [];

    expect(messages(model)).toContain(
      'Edge "a__b" in view "context" has no provenance claims.'
    );
  });

  it("enforces the 30-node-per-view cap", () => {
    const model = validModel();
    const view = model.views[0];
    for (let i = 2; i <= 30; i += 1) {
      const id = `node-${i}`;
      view.nodes.push({
        ...view.nodes[0],
        id,
        claims: [{ ...view.nodes[0].claims[0], factId: id }],
      });
      view.groups[0].nodeIds.push(id);
    }

    expect(messages(model)).toContain(
      'View "context" has 31 nodes; the maximum is 30.'
    );
  });
});

describe("source-map adapter", () => {
  it("projects the committed source-map deterministically", () => {
    const sourceMap = loadSourceMapJson();
    const shuffled = structuredClone(sourceMap);

    for (const view of Object.values(shuffled.views ?? {})) {
      if (!view) continue;
      view.nodes?.reverse();
      view.edges?.reverse();
      view.annotations?.reverse();
      for (const entity of [...(view.nodes ?? []), ...(view.edges ?? [])]) {
        entity.claims?.reverse();
        for (const claim of entity.claims ?? []) claim.sources?.reverse();
      }
      for (const members of Object.values(view.boundaries ?? {})) {
        if (Array.isArray(members)) members.reverse();
      }
    }

    const first = buildArchitectureModel(sourceMap);
    const second = buildArchitectureModel(shuffled);

    expect(second).toEqual(first);
    expect(first.views.map((view) => view.id)).toEqual([
      "context",
      "containers",
      "task-lifecycle",
    ]);
    for (const view of first.views) {
      expect(view.nodes.map((node) => node.id)).toEqual(
        [...view.nodes.map((node) => node.id)].sort()
      );
      expect(view.nodes.length).toBeLessThanOrEqual(30);
    }
  });
});

describe("GET /api/architecture/model", () => {
  it("returns the validated model in the shared response envelope", async () => {
    const response = await modelRoute.GET(
      new Request("http://test/api/architecture/model"),
      { params: Promise.resolve({}) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ArchitectureModelSchema.safeParse(body.data).success).toBe(true);
  });
});
