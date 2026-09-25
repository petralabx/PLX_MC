// Mission Control top bar (ADR-005). One element for every tier; mc-shell.css
// decides which slots show:
//   phone   mark · screen title · search icon · avatar
//   ≥641    wordmark · search field (⌘K hint, hidden on touch) · sync pill ·
//           theme toggle · avatar; the static workspace label joins when the
//           bar is ≥900 wide and "Mission Control" when ≥1280 (container queries)
//   ≥1600   + details-pane toggle on collection screens
//   ≥2200   + pin agent activity
import Image from "next/image";
import { Moon, PanelRight, Pin, Search, Sun } from "lucide-react";

import { useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import { dataSource, storeSyncCounts } from "@/lib/mc-data/store";

import { Avatar, PMark } from "./atoms";
import { isPlainLeftClick, navHref, screenTitle } from "./nav-model";
import type { Nav, Route } from "./route";

/** The sync pill only claims "Synced" once the server has answered. */
function syncStatus(): { cls: "ok" | "warn" | "pending"; label: string } {
  const source = dataSource();
  if (source === "seed") return { cls: "pending", label: "Checking…" };
  if (source === "offline") return { cls: "pending", label: "Sync unknown" };
  const c = storeSyncCounts();
  const need = c.conflict + c.error;
  if (need > 0) return { cls: "warn", label: `${need} to resolve` };
  if (c.pending > 0) return { cls: "pending", label: `${c.pending} pending` };
  return { cls: "ok", label: "Synced" };
}

export function Topbar({
  route,
  nav,
  dark,
  setDark,
  onOpenPalette,
  pane,
  live,
}: {
  route: Route;
  nav: Nav;
  dark: boolean;
  setDark: (next: boolean) => void;
  onOpenPalette: () => void;
  /** ≥1600 on collection screens: show / hide the persistent details pane. */
  pane?: { shown: boolean; toggle: () => void };
  /** ≥2200: pin / unpin the agent-activity column. */
  live?: { pinned: boolean; toggle: () => void };
}) {
  useMcVersion();
  const viewer = useViewer();
  const sync = syncStatus();

  return (
    <header className="mc-top">
      <a
        href={navHref({ screen: "home" })}
        className="brand"
        onClick={(event) => {
          if (!isPlainLeftClick(event)) return;
          event.preventDefault();
          nav("home");
        }}
      >
        <Image
          src={dark ? "/brand/logo-horizontal-cream.png" : "/brand/logo-horizontal-ink.png"}
          alt="Petra Lab-X"
          width={409}
          height={107}
          className="brand-logo"
          priority
        />
        <span className="sub">Mission Control</span>
      </a>
      {/* A static label until a real workspace switcher exists (spec Q9). */}
      <span className="ws" title="Workspace">
        <PMark acc />
        <span>PLX Engineering</span>
      </span>
      <span className="title">{screenTitle(route.screen)}</span>
      <div className="r">
        <button type="button" className="search" onClick={onOpenPalette}>
          <Search className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          <span className="search-hint">Search · jump · create…</span>
          <span className="key kbd-hint">⌘K</span>
        </button>
        <button type="button" className="iconbtn search-icon" aria-label="Search, jump or create" onClick={onOpenPalette}>
          <Search className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
        </button>
        {pane ? (
          <button
            type="button"
            className="iconbtn wide-only"
            aria-label="Details pane"
            aria-pressed={pane.shown}
            aria-controls="mc-pane"
            onClick={pane.toggle}
          >
            <PanelRight className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          </button>
        ) : null}
        {live ? (
          <button
            type="button"
            className="iconbtn ultra-only"
            aria-label="Pin agent activity"
            aria-pressed={live.pinned}
            onClick={live.toggle}
          >
            <Pin className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          </button>
        ) : null}
        <button
          type="button"
          className={`topsync ${sync.cls}`}
          onClick={() => nav("sync")}
          title="SharePoint sync issues · review queue"
          data-testid="nav-sync-console"
        >
          <span className="d" />
          <span className="lb">{sync.label}</span>
        </button>
        <button
          type="button"
          className="iconbtn theme"
          aria-label="Dark mode"
          aria-pressed={dark}
          onClick={() => setDark(!dark)}
        >
          {dark ? (
            <Sun className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          ) : (
            <Moon className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          )}
        </button>
        {viewer ? (
          <Avatar actor={viewer} id={viewer.id} size="lg" title={`${viewer.name} · ${viewer.role}`} />
        ) : null}
      </div>
    </header>
  );
}
