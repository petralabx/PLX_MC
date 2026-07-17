// Architecture provenance types — slim view over docs/architecture/source-map.json.
// The source-map is a generated consumer index; AGENTS.md / docs/modules/* remain canonical.

export type ArchitectureViewId = "context" | "containers" | "task-lifecycle";

export type ProvenanceSourceRow = {
  path: string;
  authority_class: string;
  start_line: number | null;
  end_line: number | null;
  claim_count: number;
};

export type ArchitectureProvenance = {
  view: ArchitectureViewId;
  schema_version: string;
  notice: string;
  source_commit: string;
  node_count: number;
  edge_count: number;
  sources: ProvenanceSourceRow[];
};
