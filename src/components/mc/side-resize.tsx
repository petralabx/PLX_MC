"use client";

// The zoned sidebar's edge from 1025px (TASK-3957; portal ADR-011 v2, Width 1
// to 5): a window splitter that drags, steps with ← and →, resets on a
// double-click and collapses with Enter; in the rail, an expand button in its
// place, so the splitter's value never drops below its minimum. CSS shows each
// in its own form and hides both below 1025px. Also the rail's labels: an icon
// names itself after 300ms of hover, or at once on keyboard focus (ADR-011,
// Behaviour 6).
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronRight } from "lucide-react";

import { SIDE_MAX, SIDE_MIN } from "./side-boot";
import {
  dragSideWidth,
  paintSide,
  setSideRail,
  setSideWidth,
  sideKeyAction,
  sideRailPref,
  sideWidthPref,
  useSideLayout,
} from "./side-width";

export function SideResize() {
  const { width, rail } = useSideLayout();
  const [drag, setDrag] = useState<{ width: number; collapse: boolean } | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const expandRef = useRef<HTMLButtonElement | null>(null);
  // Enter collapses and the expand button expands: focus moves to the control
  // that takes the other's place.
  const focusNext = useRef<"handle" | "expand" | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    (next === "handle" ? handleRef : expandRef).current?.focus();
  }, [rail]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const x0 = event.clientX;
    const w0 = width;
    let latest = { width: w0, collapse: false };
    handle.setPointerCapture(event.pointerId);
    setDrag(latest);
    const move = (e: PointerEvent) => {
      latest = dragSideWidth(w0, e.clientX - x0);
      paintSide(latest.width, false);
      setDrag(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDrag(null);
      // Collapsing keeps the width from before the drag, for the next expand.
      if (latest.collapse) setSideRail(true);
      else if (latest.width !== w0) setSideWidth(latest.width);
      else paintSide(sideWidthPref.get(), sideRailPref.get());
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const action = sideKeyAction(width, event.key, event.shiftKey);
    if (!action) return;
    event.preventDefault();
    if ("rail" in action) {
      focusNext.current = "expand";
      setSideRail(true);
    } else {
      setSideWidth(action.width);
    }
  };

  const shown = drag?.width ?? width;
  return (
    <>
      <div
        ref={handleRef}
        className={`side-resize${drag ? " dragging" : ""}`}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-controls="mc-nav"
        aria-valuemin={SIDE_MIN}
        aria-valuemax={SIDE_MAX}
        aria-valuenow={shown}
        aria-valuetext={`${shown} pixels`}
        title="Drag to resize. Double-click to reset. Enter collapses."
        onPointerDown={startDrag}
        onDoubleClick={() => setSideWidth(null)}
        onKeyDown={onKeyDown}
      >
        {drag ? (
          <span className="side-resize-w" aria-hidden="true">
            {drag.collapse ? "Release to collapse" : `${drag.width} px`}
          </span>
        ) : null}
      </div>
      <button
        ref={expandRef}
        type="button"
        className="side-expand"
        aria-label="Expand sidebar"
        aria-controls="mc-nav"
        aria-expanded={!rail}
        title="Expand sidebar ([)"
        onClick={() => {
          focusNext.current = "handle";
          setSideRail(false);
        }}
      >
        <ChevronRight className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
      </button>
    </>
  );
}

/** The nav is in a rail form (the 641–1024px rail, or the collapsed sidebar). */
const inRailForm = (nav: HTMLElement) => nav.getBoundingClientRect().width < 100;

/** A visual label beside a rail icon; the row's accessible name already says it. */
export function RailLabel() {
  const [label, setLabel] = useState<{ text: string; top: number; left: number } | null>(null);
  useEffect(() => {
    const nav = document.getElementById("mc-nav");
    if (!nav) return;
    let timer: number | undefined;
    // Once a label shows, moving to the next icon swaps it at once.
    let showing = false;
    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const rowOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(".item") : null;
    const show = (row: HTMLElement) => {
      if (!inRailForm(nav)) return;
      const text = (row.querySelector(".nm")?.textContent ?? row.getAttribute("aria-label") ?? "").trim();
      if (!text) return;
      const box = row.getBoundingClientRect();
      showing = true;
      setLabel({ text, top: Math.round(box.top + box.height / 2), left: Math.round(nav.getBoundingClientRect().right + 8) });
    };
    const hide = () => {
      clear();
      showing = false;
      setLabel(null);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const row = rowOf(event.target);
      clear();
      if (!row) {
        hide();
        return;
      }
      if (showing) show(row);
      else timer = window.setTimeout(() => show(row), 300);
    };
    const onFocus = (event: FocusEvent) => {
      const row = rowOf(event.target);
      if (!row || !row.matches(":focus-visible")) return;
      clear();
      show(row);
    };
    nav.addEventListener("pointerover", onOver);
    nav.addEventListener("pointerleave", hide);
    nav.addEventListener("focusin", onFocus);
    nav.addEventListener("focusout", hide);
    nav.addEventListener("scroll", hide, { passive: true });
    return () => {
      clear();
      nav.removeEventListener("pointerover", onOver);
      nav.removeEventListener("pointerleave", hide);
      nav.removeEventListener("focusin", onFocus);
      nav.removeEventListener("focusout", hide);
      nav.removeEventListener("scroll", hide);
    };
  }, []);
  if (!label) return null;
  return (
    <div className="rail-label" aria-hidden="true" style={{ top: label.top, left: label.left }}>
      {label.text}
    </div>
  );
}
