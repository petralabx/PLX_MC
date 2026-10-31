// Screen registry — the shell renders SCREENS[route.screen].
import type { ComponentType } from "react";

import { ActivityView } from "./activity-view";
import { AiSpendView } from "./vendor-spend";
import { AgentFeed } from "./agent-feed";
import { BucketDetail } from "./bucket-detail";
import { CiScorecardView } from "./ci-scorecard";
import { DashboardView } from "./dashboard";
import { DraftsView } from "./drafts";
import { ProjectDetail } from "./project-detail";
import { FilesView } from "./files-view";
import { GoalsView } from "./goals";
import { ArchitectureView } from "./architecture";
import { BrainAskView } from "./brain-ask";
import { GovernanceSopsView } from "./governance-sops";
import { SkillsDirectoryView } from "./skills-directory";
import { HelpView } from "./help";
import { InboxView } from "./inbox";
import { InsightsView } from "./insights";
import { MeetingIntakeView } from "./meeting-intake";
import { LoopLedgersView } from "./loop-ledgers";
import { ReposView } from "./repos-view";
import type { Screen, ScreenProps } from "./route";
import { RoutingInboxView } from "./routing-inbox";
import { ApprovalsInboxView } from "./approvals-inbox";
import { SyncConsole } from "./sync-console";
import { TaskDetailView } from "./task-detail";
import { TraceabilityMatrix } from "./traceability";
import { UatScorecardView } from "./uat-scorecard";
import { WorkViews } from "./work-views";

export const SCREENS: Record<Screen, ComponentType<ScreenProps>> = {
  home: InboxView,
  dashboard: DashboardView,
  board: WorkViews,
  list: WorkViews,
  timeline: WorkViews,
  // My Tasks reuses WorkViews, pre-filtered to the current user (do not fork).
  mine: WorkViews,
  insights: InsightsView,
  matrix: TraceabilityMatrix,
  feed: AgentFeed,
  bucket: BucketDetail,
  project: ProjectDetail,
  // The Projects row opens the project Dashboard (TASK-3996); Reporting keeps
  // its Dashboard row at its own URL.
  projects: DashboardView,
  repos: ReposView,
  files: FilesView,
  sync: SyncConsole,
  intake: MeetingIntakeView,
  task: TaskDetailView,
  "loop-ledgers": LoopLedgersView,
  "governance-sops": GovernanceSopsView,
  "skills-directory": SkillsDirectoryView,
  architecture: ArchitectureView,
  "brain-ask": BrainAskView,
  "ai-spend": AiSpendView,
  "ci-scorecard": CiScorecardView,
  "uat-scorecard": UatScorecardView,
  "routing-inbox": RoutingInboxView,
  approvals: ApprovalsInboxView,
  drafts: DraftsView,
  activity: ActivityView,
  goals: GoalsView,
  help: HelpView,
};
