"use client";

import type { CSSProperties, DragEvent } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { BUCKET_IDX, CYCLES, MILESTONES, STAGES, STAGE_IDX } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  allTasks,
  reassignTask,
  setTaskBucket,
  setTaskPriority,
  setTaskStage,
  taskById,
} from "@/lib/mc-data/store";
import type { Bucket, Stage, Task } from "@/lib/mc-data";

import { Assignee, Confidence, Label, Priority, RepoChip, ReqChip, Spine, SyncTick } from "./atoms";
import { FilterBar } from "./filter-bar";
import type { ScreenProps } from "./route";
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
  const resolved = resolveColumnDrop(groupBy, columnKey);
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
  onOpen,
}: {
  tasks: Task[];
  groupBy: GroupBy;
  swimlanes: BoardSwimlanes;
  onOpen: (taskId: string) => void;
}) {
  const columns = boardColumns(groupBy, tasks);
  const byColumn = partitionTasksByColumn(tasks, groupBy);

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
        return (
          <div className="bcol" key={column.key}>
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
                        {list.length === 0 && <div className="colempty">Empty</div>}
                      </>
                    );
                  })()}
                </>
              ) : list.length > 0 ? (
                list.map((task) => (
                  <TaskCard key={task.id} task={task} onOpen={onOpen} draggable={dragEnabled} />
                ))
              ) : (
                <div className="colempty">Empty</div>
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
  const groups = groupTasksForList(tasks, groupBy);
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
                <span
                  className="duecell"
                  style={{ fontFamily: "var(--mono)", fontSize: "10px", color: "var(--p-muted)" }}
                >
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
  const buckets = bucketsForTimeline(tasks);
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
                        className={`bar ${timelineSegmentClass(task)}${
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

  // One unified axis drives board + list; `swimlanes` stays board-only state.
  // Both `groupBy` and `filters` live here (not in BoardView/ListView) so they
  // persist across the board/list/timeline tab switch — the `vsw` switcher
  // keeps WorkViews mounted.
  const [groupBy, setGroupBy] = useState<GroupBy>("band");
  const [swimlanes, setSwimlanes] = useState<BoardSwimlanes>("off");
  const [filters, setFilters] = useState<FilterState>({});
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const screen = route.screen;

  // Switching to a non-band/stage axis forces swimlanes OFF (not merely hides
  // the toggle): BoardView keys its sub-lanes off the `swimlanes` prop alone,
  // so leaving it "agents" under bucket/priority/assignee would render
  // meaningless sub-lanes inside those columns (SPEC §5 swimlanes reset).
  const changeGroupBy = (next: GroupBy) => {
    setGroupBy(next);
    if (!swimlanesAllowed(next)) setSwimlanes("off");
  };

  const bucket = route.bucketId ? BUCKET_IDX[route.bucketId] : undefined;
  const baseTasks = filterTasksByBucket(allTasks(), route.bucketId);
  const visible = useMemo(
    () => applyFilters(filterTasksByBucket(allTasks(), route.bucketId), filters),
    // `version` is a deliberate dependency: `allTasks()` reads the external
    // store (not a captured value the linter can see), so the bumped version is
    // what re-pivots the filtered/grouped board after a mutation. Without it the
    // memo would return a stale snapshot on the next store emit (SPEC §5).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.bucketId, filters, version]
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

  const goView = (next: "board" | "list" | "timeline") => {
    nav(next, route.bucketId ? { bucketId: route.bucketId } : undefined);
  };

  const openTask = (taskId: string) => nav("task", { taskId });
  const title = bucket ? splitTitleAccent(bucket.name) : { lead: "All", accent: "work" };

  return (
    <div className="mc-main">
      <div className="ph" style={{ paddingBottom: 14 }}>
        <div>
          <span className="kk">Workspace{bucket ? ` · ${bucket.id}` : ""}</span>
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
            Board, list, and timeline are three lenses over the same task ledger across buckets.
          </p>
        </div>
        <div className="r">
          <button type="button" className="btn ghost" onClick={() => nav("feed")}>
            Agent activity ◉
          </button>
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
            ].map((view) => (
              <button
                key={view.key}
                type="button"
                className={screen === view.key ? "on" : ""}
                onClick={() => goView(view.key as "board" | "list" | "timeline")}
              >
                {view.label}
              </button>
            ))}
          </div>
        </div>
        <div className="r">
          {(screen === "board" || screen === "list") && (
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
              {screen === "board" && swimlanesAllowed(groupBy) && (
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
            <b>{screen === "timeline" ? baseTasks.length : visible.length}</b> tasks
          </span>
        </div>
      </div>

      {/* The filter bar drives the board + list only; the timeline stays the
          fixed June grid over the full bucket scope (filtering it is Cycle 2). */}
      {screen === "timeline" ? (
        baseTasks.length === 0 ? (
          <div className="empty">
            <h3>A calm, empty board</h3>
            <p>No tasks in this initiative yet.</p>
          </div>
        ) : (
          <TimelineView tasks={baseTasks} onOpen={openTask} />
        )
      ) : (
        <>
          <FilterBar
            ref={filterInputRef}
            filters={filters}
            onChange={setFilters}
            resultCount={visible.length}
            labels={labelOptions}
            assignees={assigneeOptions}
            hasUnassigned={hasUnassigned}
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
                  <p>No tasks in this initiative yet.</p>
                </>
              )}
            </div>
          ) : screen === "board" ? (
            <BoardView tasks={visible} groupBy={groupBy} swimlanes={swimlanes} onOpen={openTask} />
          ) : (
            <ListView tasks={visible} groupBy={groupBy} onOpen={openTask} />
          )}
        </>
      )}
    </div>
  );
}
