// Mission Control chrome: the Topbar and Sidebar shared by every screen.
// Ported from docs/product/prototype/mc-chrome.jsx. Counts come from the
// runtime store so the sync pill and badges stay live after store actions.
// The command palette (⌘K) mounts here when the authoring lane lands.
import type { ReactNode } from "react";

import { AGENTS, BUCKETS } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { storeSyncCounts, unreadCount } from "@/lib/mc-data/store";

import { Avatar, PMark } from "./atoms";
import type { Nav, Route, Screen } from "./route";

export function Topbar({
  nav,
  dark,
  setDark,
  onOpenPalette,
}: {
  nav: Nav;
  dark: boolean;
  setDark: (next: boolean) => void;
  onOpenPalette: () => void;
}) {
  useMcVersion();
  const c = storeSyncCounts();
  const need = c.conflict + c.error;
  const cls = need > 0 ? "warn" : c.pending > 0 ? "pending" : "ok";
  const label =
    need > 0 ? `${need} to resolve` : c.pending > 0 ? `${c.pending} pending` : "Synced";

  return (
    <header className="mc-top">
      <div className="l">
        <button type="button" className="brand" onClick={() => nav("home")}>
          <span className="mark">Petra Lab-X</span>
          <span className="sub">Mission Control</span>
        </button>
        <div className="ws">
          <PMark acc />
          <span>PLX Engineering</span>
          <span className="chev">▾</span>
        </div>
      </div>
      <div className="r">
        <button type="button" className="search" onClick={onOpenPalette}>
          <span style={{ fontFamily: "var(--mono)", fontSize: "10px", letterSpacing: "0.1em" }}>
            Search · jump · create…
          </span>
          <span className="key">⌘K</span>
        </button>
        <button
          type="button"
          className={`topsync ${cls}`}
          onClick={() => nav("sync")}
          title="SharePoint sync"
        >
          <span className="d" />
          <span className="lb">{label}</span>
        </button>
        <button
          type="button"
          className="iconbtn"
          title={dark ? "Light mode" : "Dark mode"}
          onClick={() => setDark(!dark)}
        >
          {dark ? "☀" : "☾"}
        </button>
        <Avatar id="maya" size="lg" title="Maya Aldosari · Admin" />
      </div>
    </header>
  );
}

export function Sidebar({ route, nav }: { route: Route; nav: Nav }) {
  useMcVersion();
  const unread = unreadCount();
  const live = Object.values(AGENTS).filter((a) => a.online).length;
  const sc = storeSyncCounts();
  const conflicts = sc.conflict + sc.error;

  const item = (target: Screen, ic: string, label: string, badge?: ReactNode) => (
    <button
      type="button"
      className={`item${route.screen === target ? " active" : ""}`}
      onClick={() => nav(target)}
    >
      <span className="ic">{ic}</span>
      <span className="nm">{label}</span>
      {badge}
    </button>
  );

  return (
    <nav className="mc-side">
      <div className="grp">
        {item(
          "home",
          "⌂",
          "Inbox",
          unread ? <span className="badge acc">{unread}</span> : null
        )}
      </div>
      <div className="grp">
        <div className="h">Views</div>
        {item("board", "▦", "Board")}
        {item("list", "≣", "List")}
        {item("timeline", "▭", "Timeline")}
        {item("matrix", "⊞", "Traceability")}
        {item("feed", "◉", "Agent activity", <span className="badge acc">{live} live</span>)}
      </div>
      <div className="grp">
        <div className="h">Buckets</div>
        {BUCKETS.map((b) => (
          <button
            type="button"
            key={b.id}
            className={`item${route.screen === "bucket" && route.bucketId === b.id ? " active" : ""}`}
            onClick={() => nav("bucket", { bucketId: b.id })}
          >
            <span className={`hl ${b.health}`} />
            <span className="nm">{b.name}</span>
          </button>
        ))}
      </div>
      <div className="grp">
        <div className="h">System of record</div>
        {item("repos", "❮❯", "Repos")}
        {item("files", "❒", "Files")}
        {item(
          "sync",
          "⇄",
          "Sync",
          conflicts ? <span className="badge hot">{conflicts}</span> : null
        )}
      </div>
    </nav>
  );
}
