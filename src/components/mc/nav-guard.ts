// A screen holding unsaved edits (the New draft form, TASK-4109) sets a guard;
// the shell asks it before every in-app navigation and before it follows the
// browser's Back or Forward. Closing or reloading the tab goes through the
// screen's own beforeunload instead. One guard at a time: the screen on show.

let guard: (() => boolean) | null = null;

/** Set the guard; it returns true when navigation may go ahead. Returns the function that clears it. */
export function setNavGuard(fn: () => boolean): () => void {
  guard = fn;
  return () => {
    if (guard === fn) guard = null;
  };
}

/** True when no guard is set, or the guard lets navigation go ahead. */
export function navAllowed(): boolean {
  return guard ? guard() : true;
}
