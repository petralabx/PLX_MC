"use client";

// A flyout from a shell control (portal ADR-011): the zoned sidebar's Admin &
// health group (TASK-3840) and the top bar's PLX app switcher (TASK-3844). It
// is a popover in the top layer, so a scrolling sidebar or the top bar cannot
// clip it. It opens on click, beside the nav level with its toggle or just
// below its toggle, and follows the toggle when the window resizes. A click
// outside, navigating, focus moving to another control (Tab past the end, ⌘K)
// or the toggle leaving the page (a narrower window can hide it) closes it.
// While it is open it owns Esc, from anywhere: the nav drawer and the screen
// underneath never see that key, and focus goes back to the toggle if it was
// in the flyout.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type ToggleEvent as ReactToggleEvent,
} from "react";

/** Beside the nav (sidebar, rail or drawer), or below the toggle (top bar). */
export type FlyoutPlacement = "beside-nav" | "below";

export function useFlyout(routeKey: string, placement: FlyoutPlacement) {
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const hide = useCallback(() => {
    try {
      panelRef.current?.hidePopover();
    } catch {
      // not open, or no popover support — nothing to close
    }
  }, []);

  // Sets --fly-* from the toggle's box. False when the toggle is not shown.
  const place = useCallback(
    (panel: HTMLElement): boolean => {
      const toggle = toggleRef.current;
      if (!toggle || toggle.getClientRects().length === 0) return false;
      const row = toggle.getBoundingClientRect();
      if (placement === "below") {
        panel.style.setProperty("--fly-left", `${Math.round(row.left)}px`);
        panel.style.setProperty("--fly-top", `${Math.round(row.bottom + 4)}px`);
        return true;
      }
      const side = toggle.closest("nav");
      if (side) {
        panel.style.setProperty("--fly-left", `${Math.round(side.getBoundingClientRect().right + 8)}px`);
        panel.style.setProperty("--fly-bottom", `${Math.max(8, Math.round(window.innerHeight - row.bottom))}px`);
        // A long panel (the rail's Projects) hangs from the toggle's top instead.
        panel.style.setProperty("--fly-top", `${Math.max(8, Math.round(row.top))}px`);
      }
      return true;
    },
    [placement]
  );

  const onBeforeToggle = useCallback(
    (event: ReactToggleEvent<HTMLDivElement>) => {
      if (event.newState === "open") place(event.currentTarget);
    },
    [place]
  );
  const onToggle = useCallback((event: ReactToggleEvent<HTMLDivElement>) => setOpen(event.newState === "open"), []);

  // A resize or zoom moves the toggle: follow it, or close with it gone.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const panel = panelRef.current;
      if (panel && !place(panel)) hide();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, place, hide]);

  // Navigating closes it.
  useEffect(() => hide(), [routeKey, hide]);

  // Document capture phase: ahead of use-layer.ts and every screen handler.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (event.key !== "Escape" || !panel || !isPopoverOpen(panel)) return;
      event.preventDefault();
      event.stopPropagation();
      const focused = document.activeElement;
      const inside = panel.contains(focused) || focused === toggleRef.current;
      hide();
      // The browser may already have put focus back where it was before the
      // flyout opened (the sidebar row that opened it with Shift F10): keep it.
      const now = document.activeElement;
      if (inside && (!now || now === document.body || panel.contains(now))) toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [hide]);

  // On the panel and on its toggle. No relatedTarget is a click on the
  // panel's padding, or the window losing focus: the flyout stays.
  const onBlur = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (!next || panelRef.current?.contains(next) || toggleRef.current?.contains(next)) return;
      hide();
    },
    [hide]
  );

  return { toggleRef, panelRef, open, hide, onBlur, onBeforeToggle, onToggle };
}

function isPopoverOpen(el: HTMLElement): boolean {
  try {
    return el.matches(":popover-open");
  } catch {
    return false; // no popover support
  }
}
