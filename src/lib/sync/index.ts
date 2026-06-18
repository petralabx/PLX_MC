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
export { validateRepoInOrg, type RepoValidation } from "./github";
export { startSyncScheduler, syncEnabled } from "./scheduler";
export {
  createBucket,
  createTask,
  patchBucket,
  patchTask,
  setBucketComments,
  snapshot,
  type CreateBucketInput,
  type CreateTaskInput,
  type PatchBucketInput,
  type PatchTaskInput,
  type StateSnapshot,
} from "./state";
