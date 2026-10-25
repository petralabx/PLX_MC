// The phone "More" sheet (ADR-005): the groups that have no tab of their own
// (Reporting, Admin & health; in the zoned shell also Knowledge and Help,
// TASK-3843, under the person's Starred, TASK-3842), the way into the full nav
// drawer (Projects and Initiatives live there — spec Q2), and appearance.
// A bottom sheet on phone; mc-shell.css makes it a centred dialog at ≥641 in
// case it is still open when the window widens. Uses the shared layer
// contract (use-layer.ts): Esc, focus in and back to More, Tab wrap, scroll lock.
import { useId, useRef } from "react";
import { X } from "lucide-react";

import { CountBadge, type Count } from "./count-badge";
import { NavIcon } from "./nav-icon";
import {
  GROUP_TAB,
  HELP_NAV_ITEM,
  isPlainLeftClick,
  navHref,
  visibleAdminFlyout,
  visibleNavGroups,
  visibleZonedNavGroups,
  type NavBadge,
  type NavFlags,
  type NavItem,
} from "./nav-model";
import { useNavZones } from "./nav-zones";
import type { Nav, Route } from "./route";
import { useLayer } from "./use-layer";
import { useStars } from "./use-stars";

/** The zoned sheet: Reporting, Knowledge, Admin & health's three sections as on desktop, then Help. */
function zonedSheetGroups(flags: NavFlags): { id: string; label: string; items: NavItem[] }[] {
  return [
    ...visibleZonedNavGroups(flags).filter((group) => group.id === "reporting" || group.id === "knowledge"),
    ...visibleAdminFlyout(flags).map((section) => ({
      id: `admin-${section.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: section.label,
      items: section.items,
    })),
    { id: "help", label: "Help", items: [HELP_NAV_ITEM] },
  ];
}

export function MoreSheet({
  open,
  onClose,
  onAllScreens,
  route,
  nav,
  flags,
  counts,
  dark,
  setDark,
}: {
  open: boolean;
  onClose: () => void;
  /** Close the sheet and open the labelled nav drawer. */
  onAllScreens: () => void;
  route: Route;
  nav: Nav;
  flags: NavFlags;
  counts: Partial<Record<NavBadge, Count>>;
  dark: boolean;
  setDark: (next: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { onKeyDown } = useLayer(open, onClose, ref);
  const headingId = useId();
  const zoned = useNavZones();
  const stars = useStars(zoned);
  if (!open) return null;
  const groups = zoned
    ? zonedSheetGroups(flags)
    : visibleNavGroups(flags).filter((group) => GROUP_TAB[group.id] === "more" && group.items.length > 0);

  return (
    <>
      <div className="mc-scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="mc-sheet"
        id="mc-more"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={ref}
        onKeyDown={onKeyDown}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={headingId}>More</h2>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose} data-autofocus>
            <X className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          </button>
        </div>
        <div className="sheet-body">
          {stars.rows.length > 0 ? (
            <div role="group" aria-labelledby={`${headingId}-starred`}>
              <div className="grp-h" id={`${headingId}-starred`}>
                Starred
              </div>
              {stars.rows.map((row) => (
                <a
                  key={row.key}
                  className="row"
                  href={navHref(row.target)}
                  onClick={(event) => {
                    if (!isPlainLeftClick(event)) return;
                    event.preventDefault();
                    const { screen, ...extra } = row.target;
                    nav(screen, extra);
                    onClose();
                  }}
                >
                  {row.lucide ? <NavIcon name={row.lucide} /> : <span className={`hl ${row.health}`} aria-hidden="true" />}
                  <span className="nm">{row.label}</span>
                </a>
              ))}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.id} role="group" aria-labelledby={`${headingId}-${group.id}`}>
              <div className="grp-h" id={`${headingId}-${group.id}`}>
                {group.label}
              </div>
              {group.items.map((item) => (
                <a
                  key={item.screen}
                  className="row"
                  href={navHref({ screen: item.screen })}
                  aria-current={route.screen === item.screen ? "page" : undefined}
                  onClick={(event) => {
                    if (!isPlainLeftClick(event)) return;
                    event.preventDefault();
                    nav(item.screen);
                    onClose();
                  }}
                >
                  <NavIcon name={item.lucide} />
                  <span className="nm">{item.label}</span>
                  {item.badge ? <CountBadge count={counts[item.badge]} /> : null}
                </a>
              ))}
            </div>
          ))}
          <div className="grp-h">Navigate</div>
          <button type="button" className="row" onClick={onAllScreens} aria-controls="mc-nav">
            <span className="nm">All screens, projects and initiatives</span>
          </button>
          <div className="grp-h">Appearance</div>
          <button type="button" className="row" aria-pressed={dark} onClick={() => setDark(!dark)}>
            <span className="nm">Dark mode</span>
            <span className="state" aria-hidden="true">
              {dark ? "On" : "Off"}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
