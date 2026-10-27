// The zoned sidebar's width and collapsed rail (TASK-3957; portal ADR-011 v2,
// Width; MC ADR-006). No "use client": the root layout (a server component)
// inlines SIDE_BOOT_SCRIPT, so it must import the string itself, not a client
// reference.
//
// Each browser keeps its width and rail choice in localStorage. CSS reads them
// from <html>: the --mc-side-w property and data-mc-side="rail". The boot
// script copies them there before the first paint, so a static page still
// paints the person's width first (ADR-006: no cookie, no per-request render).

/** Narrowest, widest and default widths in px (portal ADR-011 v2, Width; revised by TASK-4010). */
export const SIDE_MIN = 232;
export const SIDE_MAX = 400;
export const SIDE_DEFAULT = 248;
/** A drag released below this collapses the sidebar to the rail. */
export const SIDE_SNAP = 160;
/** ← and → on the splitter; with Shift, SIDE_STEP_BIG. */
export const SIDE_STEP = 16;
export const SIDE_STEP_BIG = 64;

export const SIDE_WIDTH_KEY = "mc.side.w";
export const SIDE_RAIL_KEY = "mc.side.rail";
export const SIDE_WIDTH_VAR = "--mc-side-w";
export const SIDE_RAIL_ATTR = "data-mc-side";

/** A stored width, or null (the default) when it is missing or out of range. */
export function decodeSideWidth(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= SIDE_MIN && n <= SIDE_MAX ? n : null;
}

export function clampSideWidth(width: number): number {
  return Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, width)));
}

/**
 * Runs in <head> before the first paint: copies the stored width and rail
 * choice onto <html>. Blocked storage leaves the defaults.
 */
export const SIDE_BOOT_SCRIPT = `(function(){try{var s=window.localStorage,d=document.documentElement,w=Number(s.getItem(${JSON.stringify(
  SIDE_WIDTH_KEY
)}));if(w%1===0&&w>=${SIDE_MIN}&&w<=${SIDE_MAX})d.style.setProperty(${JSON.stringify(
  SIDE_WIDTH_VAR
)},w+"px");if(s.getItem(${JSON.stringify(SIDE_RAIL_KEY)})==="1")d.setAttribute(${JSON.stringify(
  SIDE_RAIL_ATTR
)},"rail")}catch(e){}})();`;
