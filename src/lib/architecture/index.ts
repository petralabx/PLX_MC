// architecture domain barrel — provenance over docs/architecture/source-map.json.
// Import through this file; do not reach into internal modules from app code.

export type {
  ArchitectureProvenance,
  ArchitectureViewId,
  ProvenanceSourceRow,
} from "./types";

export {
  buildProvenanceForView,
  isArchitectureViewId,
  loadSourceMapJson,
} from "./source-map";
