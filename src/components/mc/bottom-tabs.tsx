// Phone chrome (<641px, ADR-005): the bottom tab bar, the group strip under
// the top bar and the New-task FAB. mc-shell.css hides all three at ≥641,
// where the rail and sidebar take over. Everything reads nav-model.ts — no
// screen is listed here.
import { useSyncExternalStore, type RefObject } from "react";
import { Plus } from "lucide-react";

import { CountBadge, type Count } from "./count-badge";
import { NavIcon } from "./nav-icon";
import {
  NAV_TABS,
  createTabMemory,
  isPaneScreen,
  isPlainLeftClick,
  navHref,
  tabOf,
  tabScreens,
  type NavBadge,
  type NavFlags,
  type NavTabId,
} from "./nav-model";
import type { Nav, Route, Screen } from "./route";

// Last screen per tab — per browser, with an in-memory fallback.
const tabMemory = createTabMemory(() => (typeof window === "undefined" ? null : window.localStorage));

/** Called by the shell on every route change. */
export function rememberTabScreen(screen: Screen) {
  tabMemory.remember(screen);
}

const LINK_TABS = NAV_TABS.filter((tab) => tab.id !== "more");

// Server snapshot: every tab lands on its home screen, so SSR and the
// hydrating render agree; the remembered screens arrive after mount.
function useTabTargets(): Record<NavTabId, Screen | undefined> {
  const joined = useSyncExternalStore(
    tabMemory.subscribe,
    () => LINK_TABS.map((tab) => tabMemory.last(tab.id) ?? "").join("|"),
    () => ""
  );
  const parts = joined.split("|");
  const targets = {} as Record<NavTabId, Screen | undefined>;
  LINK_TABS.forEach((tab, index) => {
    targets[tab.id] = (parts[index] as Screen | "") || tab.home;
  });
  return targets;
}

export function BottomTabs({
  route,
  nav,
  counts,
  moreOpen,
  onMore,
  moreRef,
}: {
  route: Route;
  nav: Nav;
  counts: Partial<Record<NavBadge, Count>>;
  moreOpen: boolean;
  onMore: () => void;
  moreRef: RefObject<HTMLButtonElement | null>;
}) {
  const active = tabOf(route.screen);
  const targets = useTabTargets();
  const more = NAV_TABS.find((tab) => tab.id === "more");

  return (
    <nav className="mc-tabs" aria-label="Primary">
      {LINK_TABS.map((tab) => {
        const target: Route = { screen: targets[tab.id] ?? "home" };
        const current = active === tab.id && !moreOpen;
        return (
          <a
            key={tab.id}
            href={navHref(target)}
            aria-current={current ? "page" : undefined}
            onClick={(event) => {
              if (!isPlainLeftClick(event)) return;
              event.preventDefault();
              nav(target.screen);
            }}
          >
            <NavIcon name={tab.lucide} />
            <span className="lb">{tab.label}</span>
            {tab.badge ? <CountBadge count={counts[tab.badge]} /> : null}
          </a>
        );
      })}
      {more ? (
        <button
          type="button"
          ref={moreRef}
          className={moreOpen || active === "more" ? "on" : undefined}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-controls="mc-more"
          onClick={onMore}
        >
          <NavIcon name={more.lucide} />
          <span className="lb">{more.label}</span>
          {more.badge ? <CountBadge count={counts[more.badge]} /> : null}
        </button>
      ) : null}
    </nav>
  );
}

/** Every screen of the current tab, one tap away, under the phone top bar. */
export function GroupStrip({ route, nav, flags }: { route: Route; nav: Nav; flags: NavFlags }) {
  const tab = tabOf(route.screen);
  const items = tabScreens(tab, flags);
  if (items.length === 0) return null;
  const label = NAV_TABS.find((t) => t.id === tab)?.label ?? "";
  return (
    <nav className="mc-subnav" aria-label={`${label} screens`}>
      {items.map((item) => (
        <a
          key={item.screen}
          href={navHref({ screen: item.screen })}
          aria-current={route.screen === item.screen ? "page" : undefined}
          onClick={(event) => {
            if (!isPlainLeftClick(event)) return;
            event.preventDefault();
            nav(item.screen);
          }}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/** Phone "New task" in the thumb zone — on My work and Plan, never over a task. */
export function NewTaskFab({ route, onNewTask }: { route: Route; onNewTask: () => void }) {
  const tab = tabOf(route.screen);
  const taskOpen = route.screen === "task" || (isPaneScreen(route.screen) && Boolean(route.taskId));
  if ((tab !== "my-work" && tab !== "plan") || taskOpen) return null;
  return (
    <button type="button" className="mc-fab" aria-label="New task" onClick={onNewTask}>
      <Plus className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
    </button>
  );
}
