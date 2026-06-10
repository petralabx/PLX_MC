"use client";

import type { CSSProperties } from "react";
import { Fragment, useMemo, useState } from "react";

import { BUCKET_IDX, CYCLES, MILESTONES, STAGES, STAGE_IDX } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allTasks } from "@/lib/mc-data/store";
import type { Bucket, Stage, Task } from "@/lib/mc-data";

import { Assignee, Confidence, Label, Priority, RepoChip, ReqChip, Spine, SyncTick } from "./atoms";
import type { ScreenProps } from "./route";
import {
  boardColumns,
  bucketsForTimeline,
  filterTasksByBucket,
  groupTasksForList,
  isTimelineCritical,
  partitionSwimlanes,
  partitionTasksByColumn,
  pctOfDay,
  timelineRangeForTask,
  timelineSegmentClass,
  type BoardGrouping,
  type BoardSwimlanes,
  type ListGroupBy,
} from "./work-views.helpers";

function splitTitleAccent(name: string): { lead: string; accent: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { lead: name, accent: "" };
  return {
    lead: parts.slice(0, -1).join(" "),
    accent: parts[parts.length - 1],
  };
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (taskId: string) => void }) {
  return (
    <button
      type="button"
      className={`tcard${task.blocked ? " blocked" : ""}`}
      onClick={() => onOpen(task.id)}
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
  grouping,
  swimlanes,
  onOpen,
}: {
  tasks: Task[];
  grouping: BoardGrouping;
  swimlanes: BoardSwimlanes;
  onOpen: (taskId: string) => void;
}) {
  const columns = boardColumns(grouping);
  const byColumn = partitionTasksByColumn(tasks, grouping);

  const stageByKey = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.key, s])), []);

  return (
    <div className={`board${grouping === "full" ? " full" : ""}`}>
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
            <div className="bbody">
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
                              <TaskCard key={task.id} task={task} onOpen={onOpen} />
                            ))}
                          </>
                        )}
                        {lanes.humans.length > 0 && (
                          <>
                            <div className="swlabel">Humans</div>
                            {lanes.humans.map((task) => (
                              <TaskCard key={task.id} task={task} onOpen={onOpen} />
                            ))}
                          </>
                        )}
                        {lanes.unassigned.length > 0 && (
                          <>
                            <div className="swlabel">Unassigned</div>
                            {lanes.unassigned.map((task) => (
                              <TaskCard key={task.id} task={task} onOpen={onOpen} />
                            ))}
                          </>
                        )}
                        {list.length === 0 && <div className="colempty">Empty</div>}
                      </>
                    );
                  })()}
                </>
              ) : list.length > 0 ? (
                list.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} />)
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
  groupBy: ListGroupBy;
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
  useMcVersion();

  const [grouping, setGrouping] = useState<BoardGrouping>("band");
  const [swimlanes, setSwimlanes] = useState<BoardSwimlanes>("off");
  const [listGroupBy, setListGroupBy] = useState<ListGroupBy>("bucket");

  const bucket = route.bucketId ? BUCKET_IDX[route.bucketId] : undefined;
  const tasks = filterTasksByBucket(allTasks(), route.bucketId);
  const screen = route.screen;

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
          {screen === "board" && (
            <>
              <span className="lbl">Stages</span>
              <div className="seg">
                <button
                  type="button"
                  className={grouping === "band" ? "on" : ""}
                  onClick={() => setGrouping("band")}
                >
                  3-band
                </button>
                <button
                  type="button"
                  className={grouping === "full" ? "on" : ""}
                  onClick={() => setGrouping("full")}
                >
                  Full lifecycle
                </button>
              </div>
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
          {screen === "list" && (
            <>
              <span className="lbl">Group</span>
              <div className="seg">
                {(["bucket", "status", "assignee"] as const).map((groupingKey) => (
                  <button
                    key={groupingKey}
                    type="button"
                    className={listGroupBy === groupingKey ? "on" : ""}
                    onClick={() => setListGroupBy(groupingKey)}
                  >
                    {groupingKey}
                  </button>
                ))}
              </div>
            </>
          )}
          <span className="count">
            <b>{tasks.length}</b> tasks
          </span>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="empty">
          <h3>A calm, empty board</h3>
          <p>No tasks match this filter yet.</p>
        </div>
      ) : (
        <>
          {screen === "board" && (
            <BoardView tasks={tasks} grouping={grouping} swimlanes={swimlanes} onOpen={openTask} />
          )}
          {screen === "list" && <ListView tasks={tasks} groupBy={listGroupBy} onOpen={openTask} />}
          {screen === "timeline" && <TimelineView tasks={tasks} onOpen={openTask} />}
        </>
      )}
    </div>
  );
}
