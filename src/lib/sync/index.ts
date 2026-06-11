// Module entry point for the sync engine (server-side only).
// Contract: docs/modules/sync/README.md · spec: docs/product/SHAREPOINT_INTEGRATION.md

export { ensureSeeded, resolveConflict, retryError, runSweep, type SweepResult } from "./engine";
export {
  displayValue,
  dueToIso,
  inboundPatches,
  isoToDue,
  outboundFields,
  parseFieldValue,
  reconcileInbound,
  type EntityType,
} from "./mapping";
export { startSyncScheduler, syncEnabled } from "./scheduler";
export {
  createTask,
  patchTask,
  snapshot,
  type CreateTaskInput,
  type PatchTaskInput,
  type StateSnapshot,
} from "./state";
