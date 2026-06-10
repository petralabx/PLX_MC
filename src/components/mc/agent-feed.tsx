import { ACTORS, AGENT_FEED, AGENTS } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { taskById } from "@/lib/mc-data/store";

import { Avatar, Slate } from "./atoms";
import type { ScreenProps } from "./route";

function chipClassName(live?: boolean, warn?: boolean): string {
  if (live) return "live";
  if (warn) return "warn";
  return "acc";
}

export function AgentFeed({ nav }: ScreenProps) {
  useMcVersion();
  const liveAgents = Object.values(AGENTS);

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
          {liveAgents.map((agent) => (
            <span key={agent.id} className="feed-agent-pill" title={`${agent.name} · ${agent.team}`}>
              <Avatar id={agent.id} size="sm" />
              <span>{agent.team}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="feed">
        {AGENT_FEED.map((event, idx) => {
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
