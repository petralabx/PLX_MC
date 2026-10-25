// Mission Control top bar (ADR-005). One element for every tier; mc-shell.css
// decides which slots show:
//   phone   mark · screen title · search icon · avatar (account menu)
//   ≥641    wordmark · search field (⌘K hint, hidden on touch) · sync pill ·
//           theme toggle · avatar; the static workspace label joins when the
//           bar is ≥900 wide and "Mission Control" when ≥1280 (container queries).
//           In the zoned shell (TASK-3844) that label is the PLX app switcher,
//           and the sync pill counts "sync conflicts".
//   ≥1600   + details-pane toggle on collection screens
//   ≥2200   + pin the live column
import type { ReactNode, RefObject } from "react";
import Image from "next/image";
import { Building2, Check, ChevronDown, Factory, Moon, PanelRight, Pin, Search, Shield, SquareKanban, Sun } from "lucide-react";

import { useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import { dataSource, storeSyncCounts } from "@/lib/mc-data/store";
import { PORTAL_ORIGIN } from "@/lib/tasks/uat-tickets";

import { PMark } from "./atoms";
import { isPlainLeftClick, navHref, screenTitle } from "./nav-model";
import { useNavZones } from "./nav-zones";
import type { Nav, Route } from "./route";
import { useFlyout } from "./use-flyout";
import { UserMenu } from "./user-menu";

const SYNC_TITLE = "SharePoint sync issues · review queue";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The sync pill only claims "Synced" once the server has answered. */
function syncStatus(zoned: boolean): { cls: "ok" | "warn" | "pending"; label: string; title: string } {
  const source = dataSource();
  if (source === "seed") return { cls: "pending", label: "Checking…", title: SYNC_TITLE };
  if (source === "offline") return { cls: "pending", label: "Sync unknown", title: SYNC_TITLE };
  const c = storeSyncCounts();
  const need = c.conflict + c.error;
  if (need > 0) {
    if (!zoned) return { cls: "warn", label: `${need} to resolve`, title: SYNC_TITLE };
    // Say what to resolve (TASK-3844): "2 sync conflicts", "3 sync errors",
    // or "2 sync conflicts, 1 error".
    const parts = [c.conflict > 0 ? count(c.conflict, "conflict") : null, c.error > 0 ? count(c.error, "error") : null];
    return {
      cls: "warn",
      label:
        c.conflict > 0
          ? `${count(c.conflict, "sync conflict")}${c.error > 0 ? `, ${count(c.error, "error")}` : ""}`
          : count(c.error, "sync error"),
      title: `SharePoint sync: ${parts.filter(Boolean).join(" and ")} to review`,
    };
  }
  if (c.pending > 0) return { cls: "pending", label: `${c.pending} pending`, title: SYNC_TITLE };
  return { cls: "ok", label: "Synced", title: SYNC_TITLE };
}

const APPS_FLYOUT_ID = "mc-apps-flyout";

/**
 * Every PLX app, as the shell contract lists them (portal ADR-011): Mission
 * Control, this app, then the portal's. The portal ships from its staging
 * branch only, so its live host is PORTAL_ORIGIN, staging.plxcustomer.io
 * (config/review-links-map.json); MRP users work there.
 */
const PLX_APPS: { name: string; sub: string; href: string; icon: ReactNode; tile: string; current?: true }[] = [
  {
    name: "Mission Control",
    sub: "Projects, tasks and approvals",
    href: navHref({ screen: "home" }),
    icon: <SquareKanban className="ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />,
    tile: "ink",
    current: true,
  },
  {
    name: "MRP Suite",
    sub: "Manufacturing, warehouse, quality",
    href: `${PORTAL_ORIGIN}/mrp`,
    icon: <Factory className="ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />,
    tile: "acc",
  },
  {
    name: "Admin portal",
    sub: "Users, access, integrations",
    href: `${PORTAL_ORIGIN}/admin/dashboard`,
    icon: <Shield className="ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />,
    tile: "line",
  },
  {
    name: "Customer portal",
    sub: "What customers see",
    href: `${PORTAL_ORIGIN}/dashboard`,
    icon: <Building2 className="ic" aria-hidden="true" focusable="false" strokeWidth={1.75} />,
    tile: "line",
  },
];

/**
 * The PLX app switcher (TASK-3844) in the workspace label's place, a flyout
 * below its toggle (use-flyout.ts). From 641px it is the mark alone; the
 * workspace name joins at 900, as the static label's does.
 */
function AppSwitcher({ route, nav }: { route: Route; nav: Nav }) {
  const { toggleRef, panelRef, open, hide, onBlur, onBeforeToggle, onToggle } = useFlyout(navHref(route), "below");
  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="ws ws-switch"
        popoverTarget={APPS_FLYOUT_ID}
        aria-controls={APPS_FLYOUT_ID}
        aria-expanded={open}
        aria-label="PLX Engineering · PLX apps"
        onBlur={onBlur}
      >
        <PMark acc />
        <span className="ws-name">PLX Engineering</span>
        <ChevronDown className="ic chev" aria-hidden="true" focusable="false" strokeWidth={1.75} />
      </button>
      <div
        ref={panelRef}
        id={APPS_FLYOUT_ID}
        popover="auto"
        className="mc-flyout drop apps"
        role="group"
        aria-label="PLX apps"
        onBeforeToggle={onBeforeToggle}
        onToggle={onToggle}
        onBlur={onBlur}
      >
        <p className="fly-h">PLX apps</p>
        {PLX_APPS.map((app) => (
          <a
            key={app.name}
            href={app.href}
            className="item app"
            aria-current={app.current ? "true" : undefined}
            onClick={(event) => {
              // This app's row stays in the app: its Home, without a reload.
              if (!app.current || !isPlainLeftClick(event)) return;
              event.preventDefault();
              hide();
              nav("home");
            }}
          >
            <span className={`app-tile ${app.tile}`}>{app.icon}</span>
            <span className="app-txt">
              <span className="nm">{app.name}</span>
              <span className="app-sub">{app.sub}</span>
            </span>
            {app.current ? <Check className="ic cur" aria-hidden="true" focusable="false" strokeWidth={2} /> : null}
          </a>
        ))}
        <p className="fly-foot">Workspace · PLX Engineering</p>
      </div>
    </>
  );
}

export function Topbar({
  route,
  nav,
  dark,
  setDark,
  onOpenPalette,
  pane,
  live,
  paneToggleRef,
  liveToggleRef,
}: {
  route: Route;
  nav: Nav;
  dark: boolean;
  setDark: (next: boolean) => void;
  onOpenPalette: () => void;
  /** ≥1600 on collection screens: show / hide the persistent details pane. */
  pane?: { shown: boolean; toggle: () => void };
  /** ≥2200: pin / unpin the live column. */
  live?: { pinned: boolean; toggle: () => void };
  /** Focus lands here when the pane or live column is closed from inside it. */
  paneToggleRef?: RefObject<HTMLButtonElement | null>;
  liveToggleRef?: RefObject<HTMLButtonElement | null>;
}) {
  useMcVersion();
  const viewer = useViewer();
  const zoned = useNavZones();
  const sync = syncStatus(zoned);

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
      {zoned ? (
        <AppSwitcher route={route} nav={nav} />
      ) : (
        // A static label until a real workspace switcher exists (spec Q9).
        <span className="ws" title="Workspace">
          <PMark acc />
          <span>PLX Engineering</span>
        </span>
      )}
      <span className="title">{screenTitle(route.screen, zoned)}</span>
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
            ref={paneToggleRef}
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
            ref={liveToggleRef}
            className="iconbtn ultra-only"
            aria-label="Pin live column"
            aria-pressed={live.pinned}
            onClick={live.toggle}
          >
            <Pin className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          </button>
        ) : null}
        <a
          href={navHref({ screen: "sync" })}
          className={`topsync ${sync.cls}`}
          onClick={(event) => {
            if (!isPlainLeftClick(event)) return;
            event.preventDefault();
            nav("sync");
          }}
          title={sync.title}
          data-testid="nav-sync-console"
        >
          <span className="d" />
          <span className="lb">{sync.label}</span>
        </a>
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
        {viewer ? <UserMenu viewer={viewer} /> : null}
      </div>
    </header>
  );
}
