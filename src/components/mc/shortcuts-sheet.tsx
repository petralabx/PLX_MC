"use client";

// The ? sheet (TASK-3958; portal ADR-011 v2, Keys 1 and 8): every shortcut,
// from SHORTCUT_GROUPS (shortcuts.ts), and the switch that turns the
// single-key ones off (WCAG 2.1.4). ? opens it, and so does the sidebar's Help
// and shortcuts row, so a person who turned the keys off can turn them back
// on. Esc closes it. A dialog on the tour's card (nav-tour.tsx).
import { Fragment, useRef } from "react";

import { isPlainLeftClick, navHref } from "./nav-model";
import type { Nav } from "./route";
import { SHORTCUT_GROUPS, singleKeysPref } from "./shortcuts";
import { usePref } from "./shell-prefs";
import { useLayer } from "./use-layer";

/** "Shift+S" → Shift + S; "g b" → g then b. */
function Keys({ keys }: { keys: string }) {
  return (
    <span className="keys">
      {keys.split(" ").map((step, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="then"> then </span> : null}
          {step.split("+").map((key, j) => (
            <Fragment key={j}>
              {j > 0 ? <span className="plus">+</span> : null}
              <kbd>{key}</kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutsSheet({
  onClose,
  nav,
}: {
  onClose: () => void;
  nav: Nav;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { onKeyDown } = useLayer(true, onClose, panelRef);
  const singleKeys = usePref(singleKeysPref, true);
  return (
    <div className="ntm-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="ntm shortcuts-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mc-shortcuts-h"
        data-testid="shortcuts-sheet"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="ntm-head">
          <div>
            <span className="kk">Help and shortcuts</span>
            <h2 id="mc-shortcuts-h">Keyboard shortcuts</h2>
          </div>
          <button
            type="button"
            className="ntm-x"
            onClick={onClose}
            aria-label="Close shortcuts"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
        <div className="ntm-body">
          <button
            type="button"
            className="keys-switch"
            role="switch"
            aria-checked={singleKeys}
            data-autofocus
            onClick={() => singleKeysPref.set(!singleKeys)}
          >
            <span className="keys-switch-txt">
              <b>Single-key shortcuts</b>
              <span>
                {singleKeys
                  ? "On. Turn them off if they get in the way of a screen reader or speech input."
                  : "Off. The keys marked off below do nothing until you turn them back on here."}
              </span>
            </span>
            <span className="usermenu-switch" aria-hidden="true" />
          </button>
          {SHORTCUT_GROUPS.map((group) => {
            const headingId = `mc-keys-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            return (
              <section
                key={group.title}
                className="keys-grp"
                aria-labelledby={headingId}
              >
                <h3 id={headingId}>{group.title}</h3>
                <dl>
                  {group.rows.map((row) => {
                    const off = row.single && !singleKeys;
                    return (
                      <div
                        className={`keys-row${off ? " off" : ""}`}
                        key={`${row.keys.join(",")}:${row.what}`}
                      >
                        <dt>
                          {row.keys.map((keys, i) => (
                            <Fragment key={keys}>
                              {i > 0 ? <span className="or"> or </span> : null}
                              <Keys keys={keys} />
                            </Fragment>
                          ))}
                        </dt>
                        <dd>
                          {row.what}
                          {off ? (
                            <span className="keys-off"> · off</span>
                          ) : null}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            );
          })}
        </div>
        <div className="ntm-foot">
          <a
            className="btn ghost"
            href={navHref({ screen: "help" })}
            onClick={(event) => {
              if (!isPlainLeftClick(event)) return;
              event.preventDefault();
              onClose();
              nav("help");
            }}
          >
            Help and glossary
          </a>
          <div className="ntm-acts">
            <button type="button" className="btn acc" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
