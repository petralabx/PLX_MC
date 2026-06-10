// Screen registry — the shell renders SCREENS[route.screen].
import type { ComponentType } from "react";

import { AgentFeed } from "./agent-feed";
import { BucketDetail } from "./bucket-detail";
import { FilesView } from "./files-view";
import { InboxView } from "./inbox";
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
  matrix: TraceabilityMatrix,
  feed: AgentFeed,
  bucket: BucketDetail,
  repos: ReposView,
  files: FilesView,
  sync: SyncConsole,
  task: TaskDetailView,
};
