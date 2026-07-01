"use client";

import type { CSSProperties, DragEvent } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
  CURRENT_USER,
  CYCLES,
  MILESTONES,
  STAGES,
  STAGE_IDX,
  tasksForUser,
} from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  allBuckets,
  allTasks,
  bucketById,
  reassignTask,
  setTaskBucket,
  setTaskPriority,
  setTaskStage,
  taskById,
} from "@/lib/mc-data/store";
import type { Bucket, Stage, Task } from "@/lib/mc-data";

import { Assignee, Confidence, Label, Priority, RepoChip, ReqChip, Spine, SyncTick } from "./atoms";
import { FilterBar } from "./filter-bar";
import type { Route, Screen, ScreenProps } from "./route";
import {
  deleteSavedView,
  loadPersistedView,
  loadSavedViews,
  newSavedViewId,
  PERSIST_VERSION,
  sanitizeFilterState,
  savePersistedView,
  saveSavedViews,
  serializeView,
  upsertSavedView,
} from "./work-views.persist";
import type { SavedView } from "./work-views.persist";
import {
  assigneeUniverse,
  applyFilters,
  boardColumns,
  bucketsForTimeline,
  dragEnabledForAxis,
  filterTasksByBucket,
  groupTasksForList,
  hasActiveFilters,
  isNoopDrop,
  isTimelineCritical,
  labelUniverse,
  partitionSwimlanes,
  partitionTasksByColumn,
  pctOfDay,
  resolveColumnDrop,
  swimlanesAllowed,
  timelineRangeForTask,
  timelineSegmentClass,
  type BoardSwimlanes,
  type FilterState,
  type GroupBy,
} from "./work-views.helpers";

// The five group-by axes, in toolbar order. `band` is the default (the current
// 3-band lifecycle); `stage` is the full 9-stage lifecycle.
const GROUP_BY_OPTIONS: Array<{ key: GroupBy; label: string }> = [
  { key: "band", label: "Band" },
  { key: "stage", label: "Stage" },
  { key: "bucket", label: "Initiative" },
  { key: "priority", label: "Priority" },
  { key: "assignee", label: "Assignee" },
];

function splitTitleAccent(name: string): { lead: string; accent: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { lead: name, accent: "" };
  return {
    lead: parts.slice(0, -1).join(" "),
    accent: parts[parts.length - 1],
  };
}

// MIME type for the dragged card id. A typed key (not text/plain) so the board
// only accepts its own cards, never arbitrary dropped text.
const DRAG_MIME = "application/x-mc-task";

// Route a resolved column-drop through the matching PR-0 spine wrapper. Pure
// dispatch — all persistence (optimistic apply + PATCH + rollback) lives in the
// store. Drag is purely additive: the same fields are mutable by their non-drag
// paths (assignee picker today; stage/priority/bucket detail controls in PR-C).
function dispatchColumnDrop(taskId: string, groupBy: GroupBy, columnKey: string) {
  const task = taskById(taskId);
  if (!task) return;
  // No-op guard: a drop on the card's current column must not PATCH (avoids a
  // spurious write + the sweep race, SPEC §5).
  if (isNoopDrop(task, groupBy, columnKey)) return;
  const resolved = resolveColumnDrop(groupBy, columnKey, allBuckets());
  if (!resolved) return; // unknown target / non-drag axis — drop, never write
  switch (resolved.field) {
    case "stage":
      setTaskStage(taskId, resolved.value as Task["stage"]);
      return;
    case "priority":
      setTaskPriority(taskId, resolved.value as Task["priority"]);
      return;
    case "bucket":
      setTaskBucket(taskId, resolved.value as string);
      return;
    case "assignee":
      // value is an actor id, or null for the "Unassigned" column.
      reassignTask(taskId, resolved.value as string | null);
      return;
  }
}

function TaskCard({
  task,
  onOpen,
  draggable,
}: {
  task: Task;
  onOpen: (taskId: string) => void;
  draggable: boolean;
}) {
  // A drag-occurred flag suppresses the click-open that fires after a drag
  // completes on a <button> (SPEC R8 drag-vs-click). Kept keyboard-accessible:
  // the element stays a real <button>, so Enter/Space still open the task.
  const draggedRef = useRef(false);

  return (
    <button
      type="button"
      className={`tcard${task.blocked ? " blocked" : ""}`}
      draggable={draggable}
      onDragStart={(event) => {
        draggedRef.current = true;
        event.dataTransfer.setData(DRAG_MIME, task.id);
        event.dataTransfer.effectAllowed = "move";
        event.currentTarget.classList.add("dragging");
      }}
      onDragEnd={(event) => {
        event.currentTarget.classList.remove("dragging");
        // Clear the flag after the click that the drag-release synthesizes.
        window.setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onClick={() => {
        if (draggedRef.current) return; // a drag just ended — don't open
        onOpen(task.id);
      }}
    >
      <div className="ct-top">
        <span className="ct-id">{task.id}</span>
        <Confidence task={task} showLabel={false} />
      </div>
      <div className="ct-title">{task.title}</div>
      <div className="ct-meta">
        <Priority p={task.priority} />
        {task.reqs.map((req) => (
          <ReqChip key={req} id={req} />
        ))}
        {task.labels.slice(0, 1).map((label) => (
          <Label key={label} text={label} />
        ))}
      </div>
      {task.repos.length > 0 && (
        <div className="ct-repos">
          {task.repos.map((repo) => (
            <RepoChip key={repo} id={repo} />
          ))}
        </div>
      )}
      <Spine task={task} />
      <div className="ct-foot">
        {task.assignee ? <Assignee id={task.assignee} /> : <span className="unassigned">+ Assign</span>}
        <SyncTick sync={task.sync} showTs={false} />
      </div>
    </button>
  );
}

function BoardView({
  tasks,
  groupBy,
  swimlanes,
  version,
  filtersActive,
  onOpen,
}: {
  tasks: Task[];
  groupBy: GroupBy;
  swimlanes: BoardSwimlanes;
  version: number;
  filtersActive: boolean;
  onOpen: (taskId: string) => void;
}) {
  const columns = boardColumns(groupBy, tasks, allBuckets());
  // Single-pass partition. `version` is a load-bearing dependency: a drag/inline
  // mutation applies optimistically by MUTATING the task object IN PLACE
  // (store.patchTaskFields → Object.assign), so `tasks` keeps the same array AND
  // object reference across the mutation — only the store `version` bumps. Without
  // it the memo would return a STALE partition and a dragged card would not move
  // to its new column until some other dep changed (axis/filter toggle). It still
  // does NOT re-bucket on a swimlane toggle (local state — `version`/`tasks`/
  // `groupBy` all unchanged), preserving the original optimization intent.
  const byColumn = useMemo(
    () => partitionTasksByColumn(tasks, groupBy, allBuckets()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, groupBy, version]
  );

  // Static lookup reused for every column header below; STAGES is constant.
  const stageByKey = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.key, s])), []);

  // Drag is enabled only on axes where a column-drop maps to a real, persisted
  // field mutation (SPEC §5 "respect axis sensibility"). Every Cycle-1 axis
  // qualifies, but the predicate is explicit so a future non-persistable axis
  // is disabled (no draggable cards / no drop targets), never a silent no-op.
  const dragEnabled = dragEnabledForAxis(groupBy);

  // Drop handlers, built per column. Reading the dragged id from dataTransfer
  // and routing through the pure resolver keeps the board's own cards the only
  // accepted payload (the DRAG_MIME key).
  const onColumnDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragEnabled || !event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault(); // allow the drop
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.classList.add("drop-active");
  };
  const onColumnDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.currentTarget.classList.remove("drop-active");
  };
  const onColumnDrop = (columnKey: string) => (event: DragEvent<HTMLDivElement>) => {
    event.currentTarget.classList.remove("drop-active");
    if (!dragEnabled) return;
    const taskId = event.dataTransfer.getData(DRAG_MIME);
    if (!taskId) return;
    event.preventDefault();
    dispatchColumnDrop(taskId, groupBy, columnKey);
  };

  // The compact 244px column grid applies to every multi-column axis (stage=9,
  // bucket, priority, assignee); only `band` (3 columns) keeps the wide default.
  return (
    <div className={`board${groupBy === "band" ? "" : " compact"}`}>
      {columns.map((column) => {
        const list = byColumn[column.key];
        const stage = stageByKey[column.key] as Stage | undefined;
        // a11y: each column is a labelled region so screen readers announce the
        // column name + card count during keyboard nav (WCAG 1.3.1). The header
        // name span carries the visible text; the region label restates it with
        // the count so the relationship card→column is announced.
        const emptyLabel = filtersActive ? "No matches in this column" : "Empty";
        return (
          <div
            className="bcol"
            key={column.key}
            role="region"
            aria-label={`${column.name} · ${list.length} ${list.length === 1 ? "task" : "tasks"}`}
          >
            <div className="bhead">
              <span className="nm">
                {stage?.n && <span className="n">{stage.n}</span>}
                {column.name}
                {stage?.gate && <span className="gate">{stage.gate} gate</span>}
              </span>
              <span className="ct">{list.length}</span>
            </div>
            <div
              className="bbody"
              onDragOver={dragEnabled ? onColumnDragOver : undefined}
              onDragLeave={dragEnabled ? onColumnDragLeave : undefined}
              onDrop={dragEnabled ? onColumnDrop(column.key) : undefined}
            >
              {swimlanes === "agents" ? (
                <>
                  {(() => {
                    const lanes = partitionSwimlanes(list);
                    return (
                      <>
                        {lanes.agents.length > 0 && (
                          <>
                            <div className="swlabel">Agents</div>
                            {lanes.agents.map((task) => (
                              <TaskCard key={task.id} task={task} onOpen={onOpen} draggable={dragEnabled} />
                            ))}
                          </>
                        )}
                        {lanes.humans.length > 0 && (
                          <>
                            <div className="swlabel">Humans</div>
                            {lanes.humans.map((task) => (
                              <TaskCard key={task.id} task={task} onOpen={onOpen} draggable={dragEnabled} />
                            ))}
                          </>
                        )}
                        {lanes.unassigned.length > 0 && (
                          <>
                            <div className="swlabel">Unassigned</div>
                            {lanes.unassigned.map((task) => (
                              <TaskCard key={task.id} task={task} onOpen={onOpen} draggable={dragEnabled} />
                            ))}
                          </>
                        )}
                        {list.length === 0 && <div className="colempty">{emptyLabel}</div>}
                      </>
                    );
                  })()}
                </>
              ) : list.length > 0 ? (
                list.map((task) => (
                  <TaskCard key={task.id} task={task} onOpen={onOpen} draggable={dragEnabled} />
                ))
              ) : (
                <div className="colempty">{emptyLabel}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  tasks,
  groupBy,
  onOpen,
}: {
  tasks: Task[];
  groupBy: GroupBy;
  onOpen: (taskId: string) => void;
}) {
  const groups = groupTasksForList(tasks, groupBy, allBuckets());
  return (
    <div className="list">
      {groups.map((group) => (
        <Fragment key={group.key}>
          <div className="grouphd">
            <span className="nm">{group.name}</span>
            <span className="ct">{group.list.length}</span>
          </div>
          <div className="lrow head">
            <span className="h">ID</span>
            <span className="h">Title</span>
            <span className="h">Assignee</span>
            <span className="h head-stage">Stage</span>
            <span className="h">Confidence</span>
            <span className="h head-due">Due</span>
            <span className="h head-sync">Sync</span>
          </div>
          {group.list.map((task) => {
            const stage = STAGES[STAGE_IDX[task.stage]];
            return (
              <button type="button" className="lrow" key={task.id} onClick={() => onOpen(task.id)}>
                <span className="id">{task.id}</span>
                <span className="title">{task.title}</span>
                <span>
                  {task.assignee ? <Assignee id={task.assignee} /> : <span className="unassigned">+ Assign</span>}
                </span>
                <span className="stagecell">
                  {stage.n} · {stage.name}
                  <Spine task={task} />
                </span>
                <span>
                  <Confidence task={task} />
                </span>
                <span className="duecell">
                  {task.due}
                </span>
                <span className="synccell">
                  <SyncTick sync={task.sync} showTs={false} />
                </span>
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function bucketHealthDotStyle(bucket: Bucket): CSSProperties {
  const tone = bucket.health === "track" ? "ok" : bucket.health === "risk" ? "warn" : "hot";
  return {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: `var(--p-${tone})`,
    display: "inline-block",
  };
}

function TimelineView({ tasks, onOpen }: { tasks: Task[]; onOpen: (taskId: string) => void }) {
  const buckets = bucketsForTimeline(tasks, allBuckets());
  return (
    <div className="tl">
      <div className="grid">
        <div className="cyc">
          <div className="corner">Bucket / task</div>
          <div className="bands">
            {CYCLES.map((cycle) => (
              <div className="b" key={cycle.id}>
                {cycle.name} · Jun {String(cycle.from).padStart(2, "0")}–{cycle.to}
              </div>
            ))}
          </div>
        </div>

        {buckets.map((bucket) => {
          const bucketTasks = tasks.filter((task) => task.bucket === bucket.id);
          const milestones = MILESTONES.filter((m) => m.bucket === bucket.id);
          return (
            <Fragment key={bucket.id}>
              <div className="grp">
                <div className="nm">
                  <span className="hl-x" style={bucketHealthDotStyle(bucket)} />
                  {bucket.name}
                </div>
                <div className="track" style={{ position: "relative", height: 26 }}>
                  {CYCLES.map((cycle, index) => (
                    <div
                      key={cycle.id}
                      className={`cycband${index % 2 === 0 ? " tint" : ""}`}
                      style={{
                        left: `${pctOfDay(cycle.from - 1)}%`,
                        width: `${pctOfDay(cycle.to - cycle.from + 1)}%`,
                      }}
                    />
                  ))}
                  {milestones.map((mile) => (
                    <div
                      key={mile.id}
                      className={`mile ${
                        mile.state === "now" ? "now" : mile.state === "risk" ? "risk" : ""
                      }`}
                      style={{ left: `${pctOfDay(mile.col)}%`, top: "50%" }}
                      title={`${mile.name} · ${mile.sp}`}
                    />
                  ))}
                </div>
              </div>

              {bucketTasks.map((task) => {
                const range = timelineRangeForTask(task.due, task.estimate);
                const stage = STAGES[STAGE_IDX[task.stage]];
                return (
                  <button type="button" className="row" key={task.id} onClick={() => onOpen(task.id)}>
                    <div className="lab">
                      <div className="t">{task.title}</div>
                      <div className="s">
                        {task.id} · {stage.name}
                      </div>
                    </div>
                    <div className="track">
                      {CYCLES.map((cycle, index) => (
                        <div
                          key={cycle.id}
                          className={`cycband${index % 2 === 0 ? " tint" : ""}`}
                          style={{
                            left: `${pctOfDay(cycle.from - 1)}%`,
                            width: `${pctOfDay(cycle.to - cycle.from + 1)}%`,
                          }}
                        />
                      ))}
                      <div
                        className={`bar ${timelineSegmentClass(task, allBuckets())}${
                          isTimelineCritical(task) ? " crit" : ""
                        }`}
                        style={{
                          left: `${range.leftPct}%`,
                          width: `${range.widthPct}%`,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function WorkViews({ route, nav }: ScreenProps) {
  // Bind the store version so the grouping/filter memo recomputes after any
  // mutation (drag/inline edit re-pivots the board). `useMcVersion()` was
  // formerly called as a bare statement and its return discarded.
  const version = useMcVersion();

  const screen = route.screen;
  // My Tasks (PR-D1) is a peer screen that reuses this whole surface, seeded
  // with the current user's tasks (SPEC §5 Module D1). It is cross-bucket by
  // definition, so it ignores route.bucketId and suppresses the bucket pill.
  const isMine = screen === "mine";

  // One unified axis drives board + list; `swimlanes` stays board-only state.
  // Both `groupBy` and `filters` live here (not in BoardView/ListView) so they
  // persist across the board/list/timeline tab switch — the `vsw` switcher
  // keeps WorkViews mounted. My Tasks defaults to grouping by initiative
  // (SPEC §5 D1: "default to list grouped by bucket").
  const [groupBy, setGroupBy] = useState<GroupBy>(isMine ? "bucket" : "band");
  const [swimlanes, setSwimlanes] = useState<BoardSwimlanes>("off");
  const [filters, setFilters] = useState<FilterState>({});
  // My Tasks is one screen, not three, so its board/list/timeline lens is local
  // state (defaults to list per SPEC §5 D1) rather than the route. The other
  // screens read their lens straight from `route.screen`.
  const [mineView, setMineView] = useState<"board" | "list" | "timeline">("list");
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  // ── Module F: filter / view persistence (SPEC §3.A) ─────────────────────────
  // Per-screen last-used state persists to localStorage and hydrates on mount
  // without an SSR mismatch (defaults render first; persisted state applies one
  // tick later). Only the work surfaces persist; the per-screen key split means
  // "My urgent" on `mine` never leaks onto the all-work board.
  const PERSIST_SCREENS: Screen[] = useMemo(() => ["board", "list", "timeline", "mine"], []);
  const persists = PERSIST_SCREENS.includes(screen);

  // Named saved views (SPEC §3.A.6) — the full list across screens; the switcher
  // filters to this screen. Hydrated in the mount effect (never at init, SSR).
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  // Write-loop / echo guards (SPEC §3.A.5.1): the persist-write effect no-ops
  // while a programmatic adopt (hydrate, route.filter, or a peer-tab storage
  // event) is in flight, so an adopt never echoes a write back to localStorage
  // or fans a storage event out to another tab.
  const hydratedRef = useRef(false);
  const adoptingRef = useRef(false);

  // route.filter is added to the Route type in Module E (the click-to-filter
  // seam, SPEC §3.B.3); this PR scaffolds the adopt so it activates the moment
  // E lands. Read defensively until then (no Route edit in PR-F).
  const routeFilter = (route as Route & { filter?: FilterState }).filter;

  // The effective board/list/timeline lens: the route screen for the normal
  // views, the local toggle for My Tasks.
  const view: "board" | "list" | "timeline" = isMine
    ? mineView
    : (screen as "board" | "list" | "timeline");

  // Switching to a non-band/stage axis forces swimlanes OFF (not merely hides
  // the toggle): BoardView keys its sub-lanes off the `swimlanes` prop alone,
  // so leaving it "agents" under bucket/priority/assignee would render
  // meaningless sub-lanes inside those columns (SPEC §5 swimlanes reset).
  const changeGroupBy = (next: GroupBy) => {
    setGroupBy(next);
    if (!swimlanesAllowed(next)) setSwimlanes("off");
  };

  // Composition precedence (SPEC §5 D1): the mine-seed REPLACES the bucket base
  // (it is not composed on top of filterTasksByBucket), then user `filters`,
  // then group-by. A `mine` route arriving with a bucketId must NOT silently
  // show "my tasks in that one bucket", so route.bucketId is ignored here.
  const bucket = isMine ? undefined : route.bucketId ? bucketById(route.bucketId) : undefined;
  const baseTasks = isMine
    ? tasksForUser(CURRENT_USER, allTasks())
    : filterTasksByBucket(allTasks(), route.bucketId);
  const visible = useMemo(
    () => applyFilters(baseTasks, filters),
    // `version` is a deliberate dependency: `allTasks()` (read inside baseTasks)
    // reads the external store (not a captured value the linter can see), so the
    // bumped version is what re-pivots the filtered/grouped board after a
    // mutation. Without it the memo would return a stale snapshot on the next
    // store emit (SPEC §5). `isMine`/`route.bucketId` re-key the source itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMine, route.bucketId, filters, version]
  );

  const labelOptions = useMemo(() => labelUniverse(baseTasks), [baseTasks]);
  const assigneeOptions = useMemo(() => assigneeUniverse(baseTasks), [baseTasks]);
  const hasUnassigned = useMemo(() => baseTasks.some((task) => !task.assignee), [baseTasks]);
  const filtersActive = hasActiveFilters(filters);

  // Keyboard (SPEC §3): "/" focuses the filter input, "Esc" clears filters.
  // Both are gated so they never fire while the user is typing in a field, and
  // PeoplePicker's capture-phase Esc (it stopPropagation()s) closes an open
  // picker before this bubble-phase handler runs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const inField = !!(event.target as HTMLElement | null)?.closest?.(
        "input,textarea,[contenteditable]"
      );
      if (event.key === "/" && !inField) {
        event.preventDefault();
        filterInputRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && !inField && filtersActive) {
        event.preventDefault();
        setFilters({});
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtersActive]);

  // ── F effect 1: hydrate-adopt (mount-only) ──────────────────────────────────
  // Read the persisted last-used view + the saved-views list, adopt the view if
  // present, then mark hydrated. `adoptingRef` is held true around the `set*`
  // calls so the write effect they schedule sees an adopt in flight and no-ops
  // (SPEC §3.A.5.1 step 1). Runs once; the empty dep array is intentional.
  useEffect(() => {
    // SSR-safe hydration (SPEC §3.A.3 #1, the store.ts:277 precedent): localStorage
    // must NOT be read in render/useState (SSR↔client mismatch), so the one-shot
    // adopt necessarily setStates from a mount effect. The cascading-render the
    // rule warns about is the intended single post-hydrate re-render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedViews(loadSavedViews());
    if (persists) {
      adoptingRef.current = true;
      const view = loadPersistedView(screen);
      if (view) {
        setGroupBy(view.groupBy);
        // Mirror the changeGroupBy invariant: swimlanes are only meaningful on
        // band/stage, so a persisted (or hand-edited) "agents" under another axis
        // is coerced off rather than rendering meaningless sub-lanes.
        setSwimlanes(swimlanesAllowed(view.groupBy) ? view.swimlanes : "off");
        setFilters(view.filters);
      }
      // Clear the adopt guard after the set*-scheduled write effect has run.
      const id = window.setTimeout(() => {
        adoptingRef.current = false;
      }, 0);
      hydratedRef.current = true;
      return () => window.clearTimeout(id);
    }
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── F effect 2: route.filter adopt (Module E seam; scaffolded here) ──────────
  // Runs after hydrate on the same mount and again whenever route.filter changes.
  // route.filter is EXPLICIT user intent (an Insights slice click) so it WINS
  // over the persisted last-used filter — which is why it runs second (SPEC
  // §3.A.5.1 step 2 / §3.B.3). Sanitized through F's trust boundary before it
  // can reach applyFilters; gated by adoptingRef so it never echoes a write.
  useEffect(() => {
    if (routeFilter === undefined) return;
    adoptingRef.current = true;
    // Adopt is an external-event sync (a route/slice click), guarded by
    // adoptingRef; the setState here is the intended adopt, not a render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(sanitizeFilterState(routeFilter));
    setActiveViewId(null);
    const id = window.setTimeout(() => {
      adoptingRef.current = false;
    }, 0);
    return () => window.clearTimeout(id);
  }, [routeFilter]);

  // ── F effect 3: persist-write (observes the state mutators) ──────────────────
  // Never writes during the initial paint, the hydrate-adopt, or a route.filter
  // / storage-event adopt (the guard). The `screen` dep means board↔list↔mine
  // each write/read their own key (SPEC §3.A.5.1 step 3).
  useEffect(() => {
    if (!hydratedRef.current || adoptingRef.current) return;
    if (!persists) return;
    savePersistedView(screen, { v: PERSIST_VERSION, groupBy, swimlanes, filters });
  }, [persists, screen, groupBy, swimlanes, filters]);

  // ── F effect 4: cross-tab sync (mount-only `storage` listener) ───────────────
  // Fires only in OTHER tabs. On a StorageEvent for THIS screen's key, re-run the
  // same deserialize/sanitize path and adopt; a peer-tab clear() (newValue null)
  // is ignored so it never blows away an active tab's filters (SPEC §3.A.3 #4).
  // The adopt sets adoptingRef so it never echoes a write back out.
  useEffect(() => {
    if (!persists) return;
    const key = `plx_mc_view_v1:${screen}`;
    const onStorage = (event: StorageEvent) => {
      if (event.key === null) return; // a full clear() — ignore
      if (event.key !== key) return;
      if (event.newValue === null) return; // peer-tab removed this key — keep ours
      const view = loadPersistedView(screen);
      if (!view) return;
      adoptingRef.current = true;
      setGroupBy(view.groupBy);
      setSwimlanes(swimlanesAllowed(view.groupBy) ? view.swimlanes : "off");
      setFilters(view.filters);
      window.setTimeout(() => {
        adoptingRef.current = false;
      }, 0);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [persists, screen]);

  // ── Saved-views CRUD (lifted to the filter bar via props, SPEC §3.A.6) ───────
  // Persist the whole list (across screens) on every change; the switcher shows
  // only this screen's views. Applying a view adopts its {groupBy,swimlanes,
  // filters} under the adopt guard so it doesn't echo a redundant write.
  const persistViews = (next: SavedView[]) => {
    setSavedViews(next);
    saveSavedViews(next);
  };
  const onSaveView = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const view: SavedView = {
      id: newSavedViewId(),
      name: trimmed,
      screen,
      groupBy,
      swimlanes,
      filters: sanitizeFilterState(filters),
    };
    persistViews(upsertSavedView(savedViews, view));
    setActiveViewId(view.id);
  };
  const onApplyView = (id: string) => {
    const view = savedViews.find((v) => v.id === id);
    if (!view) return;
    adoptingRef.current = true;
    setGroupBy(view.groupBy);
    if (!swimlanesAllowed(view.groupBy)) {
      setSwimlanes("off");
    } else {
      setSwimlanes(view.swimlanes);
    }
    setFilters(view.filters);
    setActiveViewId(view.id);
    window.setTimeout(() => {
      adoptingRef.current = false;
    }, 0);
  };
  const onDeleteView = (id: string) => {
    persistViews(deleteSavedView(savedViews, id));
    if (activeViewId === id) setActiveViewId(null);
  };
  // Views saved on this screen (the switcher's scope).
  const screenViews = useMemo(
    () => savedViews.filter((v) => v.screen === screen),
    [savedViews, screen]
  );

  // Dirty cue (SPEC §3.A.6, OPTIONAL — cheap given the switcher is in this PR):
  // the active view shows a subtle "• modified" dot when the live state diverges
  // from its saved snapshot. Compared via the same serializer so a field-order or
  // empty-facet difference doesn't false-positive; re-saving or applying clears it.
  const activeViewDirty = useMemo(() => {
    if (activeViewId === null) return false;
    const view = savedViews.find((v) => v.id === activeViewId);
    if (!view) return false;
    const live = serializeView({ v: PERSIST_VERSION, groupBy, swimlanes, filters });
    const saved = serializeView({
      v: PERSIST_VERSION,
      groupBy: view.groupBy,
      swimlanes: view.swimlanes,
      filters: view.filters,
    });
    return live !== saved;
  }, [activeViewId, savedViews, groupBy, swimlanes, filters]);

  // On the normal screens the lens switch is a route navigation; on My Tasks it
  // flips the local lens so the user stays inside their pre-filtered view.
  const goView = (next: "board" | "list" | "timeline") => {
    if (isMine) {
      setMineView(next);
      return;
    }
    nav(next, route.bucketId ? { bucketId: route.bucketId } : undefined);
  };

  const openTask = (taskId: string) => nav("task", { taskId });
  const title = isMine
    ? { lead: "My", accent: "Tasks" }
    : bucket
      ? splitTitleAccent(bucket.name)
      : { lead: "All", accent: "work" };

  return (
    <div className="mc-main" data-testid="board-screen" data-mc-view={screen}>
      <div className="ph ph-compact">
        <div>
          <span className="kk">{isMine ? "My Tasks" : `Workspace${bucket ? ` · ${bucket.id}` : ""}`}</span>
          <h1>
            {title.lead}
            {title.accent ? (
              <>
                {" "}
                <em>{title.accent}</em>
              </>
            ) : null}
          </h1>
          <p className="sub">
            {isMine
              ? "Assigned to, co-owned by, or reported by you — across every initiative."
              : "Board, list, and timeline are three lenses over the same task ledger across buckets."}
          </p>
        </div>
        <div className="r">
          <button type="button" className="btn ghost" onClick={() => nav("feed")}>
            Agent activity ◉
          </button>
          {/* The bucket pill is suppressed on My Tasks (SPEC §5 D1): the view is
              cross-bucket, so it must not display a bucket scope it isn't honoring. */}
          {bucket && (
            <button type="button" className="pill muted" onClick={() => nav(screen)}>
              <span className="dot" />
              {bucket.id} ✕
            </button>
          )}
        </div>
      </div>

      <div className="tb">
        <div className="l">
          <div className="vsw">
            {[
              { key: "board", label: "Board" },
              { key: "list", label: "List" },
              { key: "timeline", label: "Timeline" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={view === tab.key ? "on" : ""}
                onClick={() => goView(tab.key as "board" | "list" | "timeline")}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="r">
          {(view === "board" || view === "list") && (
            <>
              <span className="lbl">Group by</span>
              <div className="seg">
                {GROUP_BY_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={groupBy === option.key ? "on" : ""}
                    onClick={() => changeGroupBy(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {view === "board" && swimlanesAllowed(groupBy) && (
                <>
                  <span className="lbl">Swimlanes</span>
                  <div className="seg">
                    <button
                      type="button"
                      className={swimlanes === "off" ? "on" : ""}
                      onClick={() => setSwimlanes("off")}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      className={swimlanes === "agents" ? "on" : ""}
                      onClick={() => setSwimlanes("agents")}
                    >
                      Human · Agent
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          <span className="count">
            <b>{visible.length}</b> tasks
          </span>
        </div>
      </div>

      {/* The filter bar now drives ALL three lenses (Module G, SPEC §3.G.1): the
          board + list AND the timeline read the same filtered `visible` set, so
          one FilterState narrows three lenses (incl. the due-range facet). The
          fixed June grid / milestones / Gantt math are untouched — only the SET
          of rows narrows. */}
      <FilterBar
        ref={filterInputRef}
        filters={filters}
        onChange={setFilters}
        resultCount={visible.length}
        labels={labelOptions}
        assignees={assigneeOptions}
        hasUnassigned={hasUnassigned}
        savedViews={screenViews}
        activeViewId={activeViewId}
        activeViewDirty={activeViewDirty}
        onSaveView={onSaveView}
        onApplyView={onApplyView}
        onDeleteView={onDeleteView}
      />

      {visible.length === 0 ? (
        <div className="empty">
          {filtersActive ? (
            <>
              <h3>No tasks match these filters</h3>
              <p>Try removing a filter to widen the results.</p>
              <button type="button" className="btn ghost" onClick={() => setFilters({})}>
                Clear filters
              </button>
            </>
          ) : (
            <>
              <h3>A calm, empty board</h3>
              <p>
                {isMine
                  ? "Nothing is assigned to, co-owned by, or reported by you yet."
                  : "No tasks in this initiative yet."}
              </p>
            </>
          )}
        </div>
      ) : view === "board" ? (
        <BoardView
          tasks={visible}
          groupBy={groupBy}
          swimlanes={swimlanes}
          version={version}
          filtersActive={filtersActive}
          onOpen={openTask}
        />
      ) : view === "timeline" ? (
        <TimelineView tasks={visible} onOpen={openTask} />
      ) : (
        <ListView tasks={visible} groupBy={groupBy} onOpen={openTask} />
      )}
    </div>
  );
}
