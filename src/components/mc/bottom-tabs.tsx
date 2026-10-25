// Phone chrome (<641px, ADR-005): the bottom tab bar, the group strip under
// the top bar and the New-task FAB. mc-shell.css hides all three at ≥641,
// where the rail and sidebar take over. Everything reads nav-model.ts — no
// screen is listed here. The zoned shell (TASK-3843) has its own tabs: Home,
// My tasks, Projects, Search and More.
import { useSyncExternalStore, type RefObject } from "react";
import { Plus } from "lucide-react";

import { CountBadge, type Count } from "./count-badge";
import { NavIcon } from "./nav-icon";
import {
  NAV_TABS,
  ZONED_NAV_TABS,
  createTabMemory,
  createZonedTabMemory,
  isNavItemCurrent,
  isPaneScreen,
  isPlainLeftClick,
  navHref,
  navItemTarget,
  tabOf,
  tabScreens,
  zonedTabOf,
  zonedTabScreens,
  type NavBadge,
  type NavFlags,
  type NavTab,
  type NavTabId,
  type TabMemory,
} from "./nav-model";
import { useNavZones } from "./nav-zones";
import type { Nav, Route, Screen } from "./route";

// Last screen per tab — per browser, with an in-memory fallback. The zoned
// tabs keep their own; the Projects page is one of Projects' landing spots.
const storage = () => (typeof window === "undefined" ? null : window.localStorage);
const tabMemory = createTabMemory(storage);
const zonedTabMemory = createZonedTabMemory(storage);

/** Called by the shell on every route change, for the tab set in use. */
export function rememberTabScreen(screen: Screen, zoned: boolean) {
  (zoned ? zonedTabMemory : tabMemory).remember(screen);
}

// Server snapshot: every tab lands on its home screen, so SSR and the
// hydrating render agree; the remembered screens arrive after mount.
function useTabTargets(tabs: readonly NavTab[], memory: TabMemory): Record<NavTabId, Screen | undefined> {
  const links = tabs.filter((tab) => tab.home);
  const joined = useSyncExternalStore(
    memory.subscribe,
    () => links.map((tab) => memory.last(tab.id) ?? "").join("|"),
    () => ""
  );
  const parts = joined.split("|");
  const targets = {} as Record<NavTabId, Screen | undefined>;
  links.forEach((tab, index) => {
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
  searchOpen,
  onSearch,
}: {
  route: Route;
  nav: Nav;
  counts: Partial<Record<NavBadge, Count>>;
  moreOpen: boolean;
  onMore: () => void;
  moreRef: RefObject<HTMLButtonElement | null>;
  /** The zoned Search tab: whether ⌘K is open, and opening it. */
  searchOpen: boolean;
  onSearch: () => void;
}) {
  const zoned = useNavZones();
  const tabs = zoned ? ZONED_NAV_TABS : NAV_TABS;
  const active = zoned ? zonedTabOf(route.screen) : tabOf(route.screen);
  const targets = useTabTargets(tabs, zoned ? zonedTabMemory : tabMemory);

  return (
    <nav className="mc-tabs" aria-label="Primary">
      {tabs.map((tab) => {
        if (tab.id === "more") {
          return (
            <button
              key={tab.id}
              type="button"
              ref={moreRef}
              className={moreOpen || active === "more" ? "on" : undefined}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-controls="mc-more"
              onClick={onMore}
            >
              <NavIcon name={tab.lucide} />
              <span className="lb">{tab.label}</span>
              {tab.badge ? <CountBadge count={counts[tab.badge]} /> : null}
            </button>
          );
        }
        if (tab.id === "search") {
          return (
            <button
              key={tab.id}
              type="button"
              className={searchOpen ? "on" : undefined}
              aria-haspopup="dialog"
              aria-expanded={searchOpen}
              onClick={onSearch}
            >
              <NavIcon name={tab.lucide} />
              <span className="lb">{tab.label}</span>
            </button>
          );
        }
        const target: Route = { screen: targets[tab.id] ?? "home" };
        const current = active === tab.id && !moreOpen && !searchOpen;
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
    </nav>
  );
}

/** Every screen of the current tab, one tap away, under the phone top bar. */
export function GroupStrip({ route, nav, flags }: { route: Route; nav: Nav; flags: NavFlags }) {
  const zoned = useNavZones();
  const tab = zoned ? zonedTabOf(route.screen) : tabOf(route.screen);
  const items = zoned ? zonedTabScreens(tab, flags) : tabScreens(tab, flags);
  if (items.length === 0) return null;
  const label = (zoned ? ZONED_NAV_TABS : NAV_TABS).find((t) => t.id === tab)?.label ?? "";
  return (
    <nav className="mc-subnav" aria-label={`${label} screens`}>
      {items.map((item) => (
        <a
          key={item.screen}
          href={navHref({ screen: navItemTarget(item, route.screen) })}
          aria-current={isNavItemCurrent(item, route.screen) ? "page" : undefined}
          onClick={(event) => {
            if (!isPlainLeftClick(event)) return;
            event.preventDefault();
            nav(navItemTarget(item, route.screen));
          }}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/** Phone "New task" in the thumb zone — on My work and Plan (zoned: Home, My tasks, Projects), never over a task. */
export function NewTaskFab({ route, onNewTask }: { route: Route; onNewTask: () => void }) {
  const zoned = useNavZones();
  const tab = zoned ? zonedTabOf(route.screen) : tabOf(route.screen);
  const onWork = zoned ? tab !== "more" : tab === "my-work" || tab === "plan";
  const taskOpen = route.screen === "task" || (isPaneScreen(route.screen) && Boolean(route.taskId));
  if (!onWork || taskOpen) return null;
  return (
    <button type="button" className="mc-fab" aria-label="New task" onClick={onNewTask}>
      <Plus className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
    </button>
  );
}
