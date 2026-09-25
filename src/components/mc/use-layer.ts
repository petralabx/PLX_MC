"use client";

// One contract for every overlay layer in the shell (ADR-005): the nav
// drawer, the More sheet, the overlay context pane, and — as "slots" — the
// ⌘K palette and the New task / project / initiative modals.
//
// - Esc closes only the TOPMOST layer. One document-level capture listener
//   owns it: if the top layer is shell-owned it closes it and stops the event,
//   so screen-level Esc handlers underneath (the palette's, WorkViews' filter
//   clear) never also fire. A slot on top owns its own Esc, so the listener
//   stands aside. Pickers and popovers that stop Esc at the window capture
//   phase (people-picker, filter-bar) still close first, because window
//   capture runs before document capture.
// - Focus moves into a layer on open ([data-autofocus] or its first control)
//   and back to whatever opened it on close.
// - Tab / Shift+Tab wrap inside an open layer (wrapFocusIndex in nav-model).
// - Body scroll locks (body.mc-lock) while any locking layer is open.
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import { wrapFocusIndex } from "./nav-model";

interface LayerEntry {
  /** null → the layer handles its own Esc (palette, modals). */
  close: (() => void) | null;
  lock: boolean;
}

const stack: LayerEntry[] = [];
let listening = false;

function onEscapeCapture(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top?.close) return;
  event.preventDefault();
  event.stopPropagation();
  top.close();
}

function syncDocument() {
  document.body.classList.toggle(
    "mc-lock",
    stack.some((entry) => entry.lock)
  );
  if (stack.length > 0 && !listening) {
    document.addEventListener("keydown", onEscapeCapture, true);
    listening = true;
  } else if (stack.length === 0 && listening) {
    document.removeEventListener("keydown", onEscapeCapture, true);
    listening = false;
  }
}

function pushLayer(entry: LayerEntry): () => void {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  stack.push(entry);
  syncDocument();
  return () => {
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    syncDocument();
    if (trigger?.isConnected) trigger.focus();
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0
  );
}

/**
 * A shell-owned layer: Esc (when topmost), focus in/out, Tab wrap, scroll
 * lock. Spread the returned onKeyDown on the layer's panel element.
 */
export function useLayer(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
  { lockScroll = true }: { lockScroll?: boolean } = {}
) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const release = pushLayer({ close: () => closeRef.current(), lock: lockScroll });
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? (panel ? focusablesIn(panel)[0] : null);
    first?.focus();
    return release;
  }, [open, panelRef, lockScroll]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!open || event.key !== "Tab") return;
      const focusables = focusablesIn(event.currentTarget);
      const next = wrapFocusIndex(
        focusables.length,
        focusables.indexOf(document.activeElement as HTMLElement),
        event.shiftKey
      );
      if (next !== null) {
        event.preventDefault();
        focusables[next].focus();
      }
    },
    [open]
  );

  return { onKeyDown };
}

/**
 * A layer that already handles its own Esc and focus-in (the ⌘K palette and
 * the New … modals). Registering it keeps the stack honest — a drawer under
 * the palette does not also close on the palette's Esc — and returns focus
 * to the control that opened it.
 */
export function useLayerSlot(open: boolean) {
  useEffect(() => {
    if (!open) return;
    return pushLayer({ close: null, lock: false });
  }, [open]);
}
