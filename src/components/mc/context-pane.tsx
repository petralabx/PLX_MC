// Context pane + pinned live column (ADR-005).
//
// The pane holds the selected item of a collection screen (Board, List, My
// tasks, Approvals). Selection lives in the URL (taskId), so every form below
// shows the same thing and collapsing one loses nothing:
//   <641     a full-screen page over the list; the tabs stay visible and
//            usable (no scrim, no Tab trap); Esc and focus in / back still work
//   641–1599 an overlay sheet (560 on tablet, 480 on desktop) with a scrim —
//            a modal layer: Esc, focus trap, focus back to the card that opened it
//   ≥1600    a persistent grid column beside the list, resizable by dragging
//            the separator or with ←/→ (16px) and Home/End; width remembered
// The live column (≥2200, pinned by the user) holds Agent activity or
// Approvals — the user picks (spec Q5), Agent activity by default.
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowLeft, PinOff, X } from "lucide-react";

import { isPlainLeftClick, navHref } from "./nav-model";
import { PANE_MAX, PANE_MIN, PANE_STEP, clampPaneWidth, type LiveKind } from "./shell-prefs";
import { useLayer } from "./use-layer";

export function ContextPane({
  selected,
  persistent,
  modal,
  width,
  onWidth,
  onClose,
  onOpenPage,
  children,
}: {
  /** The selected task id (from the URL), if any. */
  selected: string | undefined;
  /** ≥1600 and not hidden: a grid column, not an overlay layer. */
  persistent: boolean;
  /** ≥641: an overlay over the page (scrim, Tab trap, scroll lock). Below, a full-screen page. */
  modal: boolean;
  /** Current width in px (for the separator's value). */
  width: number;
  /** persist=false while dragging; true once the drag or key press settles. */
  onWidth: (width: number, persist: boolean) => void;
  onClose: () => void;
  onOpenPage: (taskId: string) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const overlay = Boolean(selected) && !persistent;
  const { onKeyDown } = useLayer(overlay, onClose, ref, { lockScroll: modal });

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const x0 = event.clientX;
    const w0 = width;
    let latest = w0;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      latest = clampPaneWidth(w0 + (x0 - e.clientX)); // the pane is on the right: dragging left widens it
      onWidth(latest, false);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      onWidth(latest, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const resizeByKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft"
        ? width + PANE_STEP
        : event.key === "ArrowRight"
          ? width - PANE_STEP
          : event.key === "Home"
            ? PANE_MIN
            : event.key === "End"
              ? PANE_MAX
              : null;
    if (next === null) return;
    event.preventDefault();
    onWidth(clampPaneWidth(next), true);
  };

  return (
    <>
      {overlay && modal ? <div className="mc-scrim for-pane" aria-hidden="true" onClick={onClose} /> : null}
      <aside
        id="mc-pane"
        className={`mc-pane${selected ? " open" : ""}`}
        aria-label="Details"
        ref={ref}
        onKeyDown={overlay && modal ? onKeyDown : undefined}
      >
        {persistent ? (
          <div
            className="pane-resize"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize details pane"
            aria-controls="mc-pane"
            aria-valuemin={PANE_MIN}
            aria-valuemax={PANE_MAX}
            aria-valuenow={width}
            onPointerDown={startResize}
            onKeyDown={resizeByKey}
          />
        ) : null}
        <div className="pane-head">
          <button type="button" className="iconbtn" aria-label="Close details" onClick={onClose} data-autofocus>
            <ArrowLeft className="ic phone-only" aria-hidden="true" focusable="false" strokeWidth={1.5} />
            <X className="ic not-phone" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          </button>
          <span className="kk">{selected ? `Task · ${selected}` : "Details"}</span>
          {selected ? (
            <a
              className="btn ghost sm"
              href={navHref({ screen: "task", taskId: selected })}
              onClick={(event) => {
                if (!isPlainLeftClick(event)) return;
                event.preventDefault();
                onOpenPage(selected);
              }}
            >
              Open page
            </a>
          ) : null}
        </div>
        <div className="pane-body">{children}</div>
      </aside>
    </>
  );
}

export function PaneEmpty() {
  return (
    <div className="pane-empty">
      <span className="kk">Nothing selected</span>
      <p>Select a task to inspect it here. The pane stays put as you move through the list.</p>
    </div>
  );
}

const LIVE_LABEL: Record<LiveKind, string> = { feed: "Agent activity", approvals: "Approvals" };

export function LiveColumn({
  kind,
  unavailable,
  onKind,
  onUnpin,
  children,
}: {
  kind: LiveKind;
  /** The kind the screen underneath already shows — it can't be picked here. */
  unavailable: LiveKind | null;
  onKind: (kind: LiveKind) => void;
  onUnpin: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="mc-live" aria-label={LIVE_LABEL[kind]}>
      <div className="live-h">
        <span className="kk">Pinned</span>
        <div className="seg" role="group" aria-label="Live column shows">
          {(["feed", "approvals"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              disabled={option === unavailable}
              title={option === unavailable ? "Shown on this screen" : undefined}
              onClick={() => onKind(option)}
            >
              {LIVE_LABEL[option]}
            </button>
          ))}
        </div>
        <button type="button" className="iconbtn" aria-label="Unpin live column" onClick={onUnpin}>
          <PinOff className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
        </button>
      </div>
      {/* A log that updates in place; it must not talk over the page. */}
      <div className="live-body" role="log" aria-live="off">
        {children}
      </div>
    </aside>
  );
}
