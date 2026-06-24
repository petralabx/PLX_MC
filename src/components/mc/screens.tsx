// Screen registry — the shell renders SCREENS[route.screen].
import type { ComponentType } from "react";

import { AgentFeed } from "./agent-feed";
import { BucketDetail } from "./bucket-detail";
import { FilesView } from "./files-view";
import { GovernanceSopsView } from "./governance-sops";
import { InboxView } from "./inbox";
import { InsightsView } from "./insights";
import { MeetingIntakeView } from "./meeting-intake";
import { LoopLedgersView } from "./loop-ledgers";
import { ReposView } from "./repos-view";
import type { Screen, ScreenProps } from "./route";
import { SyncConsole } from "./sync-console";
import { TaskDetailView } from "./task-detail";
import { TraceabilityMatrix } from "./traceability";
import { WorkViews } from "./work-views";

export const SCREENS: Record<Screen, ComponentType<ScreenProps>> = {
  home: InboxView,
  board: WorkViews,
  list: WorkViews,
  timeline: WorkViews,
  // My Tasks reuses WorkViews, pre-filtered to the current user (do not fork).
  mine: WorkViews,
  insights: InsightsView,
  matrix: TraceabilityMatrix,
  feed: AgentFeed,
  bucket: BucketDetail,
  repos: ReposView,
  files: FilesView,
  sync: SyncConsole,
  intake: MeetingIntakeView,
  task: TaskDetailView,
  "loop-ledgers": LoopLedgersView,
  "governance-sops": GovernanceSopsView,
};
