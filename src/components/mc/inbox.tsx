// Inbox / Home — the default cockpit screen.
// Ported from docs/product/prototype/mc-views.jsx › InboxView. Two sections:
// "Needs your attention" (notifications) and "Assigned to me" (the viewer's tasks).
import { useSyncExternalStore } from "react";

import { tasksForUser, type Human } from "@/lib/mc-data";
import { useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import { allTasks, inboxNotifications, markRead, unreadCount, viewerId } from "@/lib/mc-data/store";

import { Confidence } from "./atoms";
import type { ScreenProps } from "./route";

// Time-of-day greeting for the signed-in viewer. `hour` is null until the
// client clock is read (SSR has no viewer timezone), and an unresolved viewer
// is greeted without a name rather than as someone else.
export function greeting(hour: number | null, viewer: Human | null): string {
  const part =
    hour === null ? "Hello" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = viewer?.name.split(" ")[0];
  return firstName ? `${part}, ${firstName}` : part;
}

const noSubscribe = () => () => {};

export function InboxView({ nav, openNewTask }: ScreenProps & { openNewTask?: () => void }) {
  useMcVersion();
  const viewer = useViewer();
  // Server snapshot null → SSR and the hydrating render agree; the client
  // re-renders with its local hour straight after.
  const hour = useSyncExternalStore(noSubscribe, () => new Date().getHours(), () => null);
  const mine = tasksForUser(viewerId(), allTasks()).slice(0, 5);
  const unread = unreadCount();

  return (
    <div className="mc-main" data-testid="inbox-screen">
      <div className="ph">
        <div>
          <span className="kk">{greeting(hour, viewer)}</span>
          <h1>
            Mission <em>control</em>
          </h1>
          <a className="vision-link" href="/presentations/plx-platform-vision.html">
            Platform vision · team briefing ↗
          </a>
          <p className="sub">
            Your inbox and what&apos;s assigned to you. Agents work in the background — you review
            and approve. Everything resolves to a task, and every change mirrors to the record.
          </p>
        </div>
        <div className="r">
          <button type="button" className="btn ghost" onClick={() => nav("feed")}>
            Agent activity ◉
          </button>
          <button type="button" className="btn" onClick={openNewTask}>
            New ⌘K
          </button>
        </div>
      </div>

      <div className="inbox">
        <div className="grouphd">
          <span className="nm">Needs your attention</span>
          <span className="ct">{unread} unread</span>
        </div>
        {inboxNotifications().map((n) => (
          <button
            type="button"
            className={`nrow${n.unread ? " unread" : ""}`}
            key={n.id}
            onClick={() => {
              markRead(n.id);
              nav("task", { taskId: n.task });
            }}
          >
            <span className="dot" />
            <span className="nrow-main">
              <span className={`tag ${n.kind}`}>{n.kind}</span>
              <span className="body">{n.text}</span>
            </span>
            <span className="age">{n.age}</span>
          </button>
        ))}

        <div className="grouphd">
          <span className="nm">Assigned to me</span>
          <span className="ct">{mine.length} reporting</span>
        </div>
        {mine.map((t) => (
          <button
            type="button"
            className="nrow"
            key={t.id}
            onClick={() => nav("task", { taskId: t.id })}
          >
            <span className="dot" />
            <span className="nrow-main">
              <span className="id">{t.id}</span>
              <span className="body">{t.title}</span>
            </span>
            <span className="nrow-meta">
              <Confidence task={t} showLabel={false} />
              <span className="age">{t.due}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
