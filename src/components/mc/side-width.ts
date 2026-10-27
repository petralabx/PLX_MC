"use client";

// The zoned sidebar's width and collapsed rail, from 1025px (TASK-3957; portal
// ADR-011 v2, Width; MC ADR-006). The prefs hold what the person chose; CSS
// reads it from <html> (side-boot.ts), so every change paints through paintSide.
// A drag paints straight onto <html> as the pointer moves, and saves the width
// once, on release.
import {
  SIDE_DEFAULT,
  SIDE_MAX,
  SIDE_MIN,
  SIDE_RAIL_ATTR,
  SIDE_RAIL_KEY,
  SIDE_SNAP,
  SIDE_STEP,
  SIDE_STEP_BIG,
  SIDE_WIDTH_KEY,
  SIDE_WIDTH_VAR,
  clampSideWidth,
  decodeSideWidth,
} from "./side-boot";
import { createPref, usePref } from "./shell-prefs";

/** The chosen width; null is the default (SIDE_DEFAULT). */
export const sideWidthPref = createPref<number | null>(SIDE_WIDTH_KEY, decodeSideWidth, (value) =>
  value === null ? "" : String(value)
);

/** Collapsed to the rail. Expanding returns to sideWidthPref. */
export const sideRailPref = createPref<boolean>(SIDE_RAIL_KEY, (raw) => raw === "1", (value) => (value ? "1" : "0"));

/** Copy a width (null: the default) and the rail choice onto <html>, where CSS reads them. */
export function paintSide(width: number | null, rail: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (width === null) root.style.removeProperty(SIDE_WIDTH_VAR);
  else root.style.setProperty(SIDE_WIDTH_VAR, `${width}px`);
  if (rail) root.setAttribute(SIDE_RAIL_ATTR, "rail");
  else root.removeAttribute(SIDE_RAIL_ATTR);
}

export function setSideWidth(width: number | null): void {
  const next = width === null ? null : clampSideWidth(width);
  sideWidthPref.set(next);
  paintSide(next, sideRailPref.get());
}

export function setSideRail(rail: boolean): void {
  sideRailPref.set(rail);
  paintSide(sideWidthPref.get(), rail);
}

export const toggleSideRail = () => setSideRail(!sideRailPref.get());

export interface SideLayout {
  /** The width the sidebar has when expanded. */
  width: number;
  rail: boolean;
}

/** The sidebar's width and rail choice; the defaults until hydrated (the boot script painted the real ones). */
export function useSideLayout(): SideLayout {
  const width = usePref(sideWidthPref, null);
  const rail = usePref(sideRailPref, false);
  return { width: width ?? SIDE_DEFAULT, rail };
}

/** What a key on the splitter does: a new width, collapse, or nothing. */
export type SideKeyAction = { width: number } | { rail: true } | null;

export function sideKeyAction(width: number, key: string, shift: boolean): SideKeyAction {
  const step = shift ? SIDE_STEP_BIG : SIDE_STEP;
  switch (key) {
    case "ArrowLeft":
      return { width: clampSideWidth(width - step) };
    case "ArrowRight":
      return { width: clampSideWidth(width + step) };
    case "Home":
      return { width: SIDE_MIN };
    case "End":
      return { width: SIDE_MAX };
    case "Enter":
      return { rail: true };
    default:
      return null;
  }
}

/**
 * The width a drag shows: the sidebar stops at SIDE_MIN until the pointer
 * passes SIDE_SNAP, and released past it, collapses to the rail.
 */
export function dragSideWidth(startWidth: number, dx: number): { width: number; collapse: boolean } {
  const raw = startWidth + dx;
  return { width: clampSideWidth(raw), collapse: raw < SIDE_SNAP };
}
