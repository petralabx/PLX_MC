import {
  ArchitectureModelSchema,
  type ArchitectureClaim,
  type ArchitectureModel,
  type ArchitectureSourceLink,
} from "./model";
import {
  loadSourceMapJson,
  type RawArchitectureClaim,
  type RawArchitectureEntity,
  type RawArchitectureSourceMap,
  type RawArchitectureView,
} from "./source-map";
import type { ArchitectureViewId } from "./types";

const REPOSITORY_URL = "https://github.com/petralabx/PLX_MC";
const SOURCE_MAP_PATH = "docs/architecture/source-map.json";
const VIEW_IDS: ArchitectureViewId[] = [
  "context",
  "containers",
  "task-lifecycle",
];

const LEVELS = [
  { id: "context", label: "Context", title: "System context" },
  { id: "containers", label: "Container", title: "Application containers" },
  {
    id: "task-lifecycle",
    label: "Component",
    title: "Task lifecycle components",
  },
] as const;

const CATEGORIES = [
  {
    id: "human",
    label: "Human",
    colorToken: "--p-warn",
    accent: "top",
    dashed: false,
  },
  {
    id: "agent",
    label: "Agent",
    colorToken: "--p-hot",
    accent: "top",
    dashed: true,
  },
  {
    id: "internal",
    label: "Internal",
    colorToken: "--p-ink-2",
    accent: "left",
    dashed: false,
  },
  {
    id: "sync",
    label: "Sync",
    colorToken: "--p-ok",
    accent: "left",
    dashed: false,
  },
  {
    id: "data",
    label: "Data",
    colorToken: "--p-info",
    accent: "bottom",
    dashed: false,
  },
] as const;

const GROUP_PRESENTATION: Record<
  string,
  { label: string; band: number; tone: "warm" | "cool" | "plain" }
> = {
  personBoundary: { label: "People", band: 0, tone: "plain" },
  agentBoundary: { label: "External agents", band: 0, tone: "plain" },
  missionControlBoundary: {
    label: "Mission Control — logical application & work-control boundary",
    band: 1,
    tone: "warm",
  },
  dataBoundary: { label: "Operational data", band: 2, tone: "cool" },
  externalBoundary: {
    label: "External systems — systems of record",
    band: 2,
    tone: "cool",
  },
};

const NODE_LAYERS: Record<string, number> = {
  web: 0,
  api: 0,
  mcp: 0,
  audit: 1,
  task: 1,
  routing: 1,
  sync: 2,
};

const EDGE_ROUTES: Record<
  string,
  {
    aShift?: number;
    bShift?: number;
    lx?: number;
    ly?: number;
  }
> = {
  staff__web: { ly: -30 },
  web__api: { aShift: 0.2, bShift: -0.25 },
  mcp__swarm: { ly: -26 },
  task__audit: { ly: 22 },
  api__sync: { aShift: 0.1 },
  routing__postgres: { bShift: 0.25, lx: 90, ly: -26 },
  sync__postgres: { bShift: -0.25 },
  task__sharepoint: { bShift: -0.28, lx: -70, ly: 30 },
  sync__sharepoint: { bShift: 0.28 },
};

function requiredString(value: unknown, at: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${at} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asEntities(value: RawArchitectureEntity[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function asClaims(value: RawArchitectureClaim[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function sourceHref(
  commit: string,
  path: string,
  startLine: number | null,
  endLine: number | null
): string {
  const range =
    startLine === null
      ? ""
      : endLine === null || endLine === startLine
        ? `#L${startLine}`
        : `#L${startLine}-L${endLine}`;
  return `${REPOSITORY_URL}/blob/${encodeURIComponent(commit)}/${encodeURI(path)}${range}`;
}

function sourceLinks(
  claim: RawArchitectureClaim,
  modelCommit: string
): ArchitectureSourceLink[] {
  const rawSources = Array.isArray(claim.sources) ? claim.sources : [];
  return rawSources
    .map((source, index) => {
      const path = requiredString(source.path, `claim source ${index} path`);
      const commit = requiredString(
        source.source_commit ?? modelCommit,
        `claim source ${index} commit`
      );
      const startLine =
        typeof source.start_line === "number" ? source.start_line : null;
      const endLine = typeof source.end_line === "number" ? source.end_line : null;
      return {
        path,
        href: sourceHref(commit, path, startLine, endLine),
        authorityClass: requiredString(
          source.authority_class,
          `claim source ${index} authority class`
        ),
        commit,
        startLine,
        endLine,
      };
    })
    .sort((a, b) => {
      const pathOrder = a.path.localeCompare(b.path);
      if (pathOrder !== 0) return pathOrder;
      return (a.startLine ?? 0) - (b.startLine ?? 0);
    });
}

function claimsFor(
  entity: RawArchitectureEntity,
  modelCommit: string
): ArchitectureClaim[] {
  return asClaims(entity.claims)
    .map((claim, index) => ({
      factId: requiredString(claim.fact_id, `claim ${index} fact id`),
      claim: requiredString(claim.canonical_claim, `claim ${index} text`),
      summary: nullableString(claim.canonical_summary),
      sources: sourceLinks(claim, modelCommit),
    }))
    .sort((a, b) => a.factId.localeCompare(b.factId));
}

function boundariesFor(view: RawArchitectureView): Record<string, string[]> {
  if (!view.boundaries || typeof view.boundaries !== "object") return {};
  return Object.fromEntries(
    Object.entries(view.boundaries).map(([id, members]) => [
      id,
      Array.isArray(members)
        ? members.map((member, index) =>
            requiredString(member, `boundary "${id}" member ${index}`)
          )
        : [],
    ])
  );
}

function groupForNode(
  nodeId: string,
  boundaries: Record<string, string[]>
): string {
  return (
    Object.keys(boundaries)
      .sort()
      .find((groupId) => boundaries[groupId].includes(nodeId)) ?? ""
  );
}

function groupPresentation(groupId: string, fallbackBand: number) {
  return (
    GROUP_PRESENTATION[groupId] ?? {
      label: groupId,
      band: fallbackBand,
      tone: "plain" as const,
    }
  );
}

function categoryForNode(nodeId: string, groupId: string): string {
  if (groupId === "personBoundary") return "human";
  if (groupId === "agentBoundary") return "agent";
  if (groupId === "dataBoundary" || groupId === "externalBoundary") return "data";
  if (nodeId === "sync") return "sync";
  return "internal";
}

function categoryForEdge(
  fromCategory: string | undefined,
  toCategory: string | undefined
): string {
  if (fromCategory === "human") return "human";
  if (fromCategory === "agent" || toCategory === "agent") return "agent";
  if (fromCategory === "sync") return "sync";
  if (toCategory === "data") return "data";
  return "internal";
}

function buildView(
  viewId: ArchitectureViewId,
  rawView: RawArchitectureView,
  modelCommit: string
) {
  const boundaries = boundariesFor(rawView);
  const groups = Object.entries(boundaries)
    .map(([id, nodeIds], index) => {
      const presentation = groupPresentation(id, index);
      const sortedNodeIds = [...nodeIds].sort();
      return {
        id,
        label: presentation.label,
        band: presentation.band,
        tone: presentation.tone,
        nodeIds: sortedNodeIds,
        summary: {
          kicker: `Boundary · ${sortedNodeIds.length} component${sortedNodeIds.length === 1 ? "" : "s"}`,
          title: presentation.label,
          description: `Contains ${sortedNodeIds.join(" · ")}.`,
        },
      };
    })
    .sort((a, b) => a.band - b.band || a.id.localeCompare(b.id));

  const nodes = asEntities(rawView.nodes)
    .map((entity, index) => {
      const id = requiredString(entity.mermaid_id, `${viewId} node ${index} id`);
      const claims = claimsFor(entity, modelCommit);
      const group = groupForNode(id, boundaries);
      const presentation = groupPresentation(group, 0);
      const category = categoryForNode(id, group);
      const primaryClaim = claims[0];
      return {
        id,
        label: requiredString(
          entity.display_label,
          `${viewId} node "${id}" label`
        ),
        category,
        group,
        band: presentation.band,
        layer: NODE_LAYERS[id] ?? 0,
        kicker: CATEGORIES.find((candidate) => candidate.id === category)?.label,
        tagline: primaryClaim?.claim,
        description:
          primaryClaim?.summary ??
          primaryClaim?.claim ??
          `Architecture node ${id}.`,
        width: id === "sync" ? 420 : id === "task" ? 246 : 230,
        emphasis: id === "task" || undefined,
        claims,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const nodeCategories = new Map(nodes.map((node) => [node.id, node.category]));
  const edges = asEntities(rawView.edges)
    .map((entity, index) => {
      const id = requiredString(entity.mermaid_id, `${viewId} edge ${index} id`);
      const from = requiredString(entity.from, `${viewId} edge "${id}" source`);
      const to = requiredString(entity.to, `${viewId} edge "${id}" target`);
      const claims = claimsFor(entity, modelCommit);
      const primaryClaim = claims[0];
      return {
        id,
        from,
        to,
        label: requiredString(
          entity.display_label,
          `${viewId} edge "${id}" label`
        ),
        category: categoryForEdge(
          nodeCategories.get(from),
          nodeCategories.get(to)
        ),
        bidirectional: id === "sync__sharepoint" || undefined,
        note: primaryClaim?.summary ?? undefined,
        route: EDGE_ROUTES[id],
        claims,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return { id: viewId, groups, nodes, edges };
}

export function buildArchitectureModel(
  sourceMap: RawArchitectureSourceMap = loadSourceMapJson()
): ArchitectureModel {
  const sourceCommit = requiredString(
    sourceMap.source_commit,
    "source-map source_commit"
  );
  const sourceSchemaVersion = requiredString(
    sourceMap.schema_version,
    "source-map schema_version"
  );
  const notice = requiredString(sourceMap.notice, "source-map notice");
  const views = VIEW_IDS.map((viewId) => {
    const rawView = sourceMap.views?.[viewId];
    if (!rawView) throw new Error(`source-map view "${viewId}" is missing.`);
    return buildView(viewId, rawView, sourceCommit);
  });

  return ArchitectureModelSchema.parse({
    schemaVersion: "plx-architecture-model/v1",
    meta: {
      title: "PLX Mission Control",
      kicker: "System architecture · C4",
      subtitle:
        "Read-only interactive projection of architecture facts maintained in Git.",
      source: {
        path: SOURCE_MAP_PATH,
        schemaVersion: sourceSchemaVersion,
        commit: sourceCommit,
        notice,
        repositoryUrl: REPOSITORY_URL,
      },
      footer: {
        left: [notice],
        right: [`Source: ${SOURCE_MAP_PATH}`, `Commit: ${sourceCommit}`],
      },
    },
    levels: LEVELS,
    categories: CATEGORIES,
    views,
  });
}
