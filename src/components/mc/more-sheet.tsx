// The phone "More" sheet (ADR-005): Admin & health, the way into the full
// nav drawer (Projects and Initiatives live there — spec Q2), and appearance.
// A bottom sheet on phone; mc-shell.css makes it a centred dialog at ≥641 in
// case it is still open when the window widens. Uses the shared layer
// contract (use-layer.ts): Esc, focus in and back to More, Tab wrap, scroll lock.
import { useId, useRef } from "react";
import { X } from "lucide-react";

import { CountBadge, type Count } from "./count-badge";
import { NavIcon } from "./nav-icon";
import { isPlainLeftClick, navHref, visibleNavGroups, type NavBadge, type NavFlags } from "./nav-model";
import type { Nav, Route } from "./route";
import { useLayer } from "./use-layer";

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
  if (!open) return null;
  const admin = visibleNavGroups(flags).find((group) => group.id === "admin");

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
          {admin ? (
            <div role="group" aria-labelledby={`${headingId}-admin`}>
              <div className="grp-h" id={`${headingId}-admin`}>
                {admin.label}
              </div>
              {admin.items.map((item) => (
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
          ) : null}
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
