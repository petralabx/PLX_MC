import { ACTORS, AGENTS, MODE, agentIsActive } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allTasks, taskById } from "@/lib/mc-data/store";

import { Avatar, Slate } from "./atoms";
import { deriveAgentFeed } from "./record-logic";
import type { ScreenProps } from "./route";

function chipClassName(live?: boolean, warn?: boolean): string {
  if (live) return "live";
  if (warn) return "warn";
  return "acc";
}

export function AgentFeed({ nav }: ScreenProps) {
  useMcVersion();
  const tasks = allTasks();
  const liveAgents = Object.values(AGENTS);
  // Real feed: derived from agent-authored task activity (EN-005), not a fixture.
  const feed = deriveAgentFeed(tasks);

  return (
    <div className="mc-main">
      <div className="ph">
        <div>
          <span className="kk">Mission control · live</span>
          <h1>
            Agent <em>activity</em>
          </h1>
          <p className="sub">
            What agents are doing right now — assembling evidence, running QA, drafting PRDs, and
            keeping the record in sync.
          </p>
        </div>
        <div className="r feed-head-agents">
          {liveAgents.map((agent) => {
            // Honest presence: derived from in-flight assignment, not fabricated.
            const active = agentIsActive(agent.id, tasks);
            return (
              <span
                key={agent.id}
                className="feed-agent-pill"
                title={`${agent.name} · ${MODE[agent.mode].label} · ${agent.capabilities.join(", ")} · ${active ? "active" : "idle"}`}
              >
                {active && <span className="livedot" />}
                <Avatar id={agent.id} size="sm" />
                <span>
                  {agent.team} · {MODE[agent.mode].short}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="feed">
        {feed.length === 0 && (
          <div className="colempty">No agent activity yet — events appear as agents pick up tasks.</div>
        )}
        {feed.map((event, idx) => {
          const actor = ACTORS[event.actor];
          const task = taskById(event.task);
          const chipCls = chipClassName(event.live, event.warn);
          return (
            <div className={`frow${event.live ? " live" : ""}`} key={`${event.task}-${idx}`}>
              <span className="ftime">{event.age}</span>
              <div className="fbody">
                <div className="fline">
                  <span className="avatar-wrap">
                    <Avatar id={event.actor} size="sm" />
                  </span>
                  <b>{actor.name}</b> {event.text}{" "}
                  <button
                    type="button"
                    className="task-link"
                    onClick={() => nav("task", { taskId: event.task })}
                  >
                    {event.task}
                  </button>
                  {task && <span className="task-title"> · {task.title}</span>}
                </div>
                <div className="fmeta">
                  <span className={`fchip ${chipCls}`}>
                    {event.live && <span className="livedot" />}
                    {event.chip}
                  </span>
                </div>
                {event.shots && (
                  <div className="fshots">
                    {event.shots.map((shot, shotIndex) => (
                      <Slate key={shot} label={shotIndex === 0 ? "Before" : "After"} cap={shot} />
                    ))}
                  </div>
                )}
              </div>
              <div className="factions">
                {event.live && event.kind === "run" ? (
                  <>
                    <button
                      type="button"
                      className="btn acc sm"
                      onClick={() => nav("task", { taskId: event.task })}
                    >
                      Approve →
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => nav("task", { taskId: event.task })}
                    >
                      Intervene
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => nav("task", { taskId: event.task })}
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
