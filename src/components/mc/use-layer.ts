"use client";

// One contract for every overlay layer in the shell (ADR-005): the nav
// drawer, the More sheet, the overlay context pane, and — as "slots" — the
// ⌘K palette and the New task / project / initiative modals.
//
// - Esc closes only the TOPMOST layer. One document-level listener owns it,
//   in the bubble phase: React's own handlers (registered on the document at
//   hydration, so earlier) run first, and a field inside the layer that
//   handles Esc itself — a mention list, a comment being edited — calls
//   preventDefault and keeps the layer open. Otherwise, if the top layer is
//   shell-owned, the listener closes it and stops the event before the
//   window-level Esc handlers (the palette's, WorkViews' filter clear) run.
//   A slot on top owns its own Esc, so the listener stands aside. Pickers and
//   popovers that stop Esc at the window capture phase (people-picker,
//   filter-bar) never reach it.
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

function onEscape(event: KeyboardEvent) {
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
    document.addEventListener("keydown", onEscape);
    listening = true;
  } else if (stack.length === 0 && listening) {
    document.removeEventListener("keydown", onEscape);
    listening = false;
  }
}

/** True while any layer (shell-owned or slot) is open — gates global shortcuts. */
export function hasOpenLayer(): boolean {
  return stack.length > 0;
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

  // The entry lives as long as the layer is open. Changing lockScroll (the
  // pane crossing 641px, e.g. a phone rotating) only updates the lock — it
  // must not re-push the layer above newer ones or pull focus back into it.
  const entryRef = useRef<LayerEntry | null>(null);
  const lockRef = useRef(lockScroll);
  useEffect(() => {
    lockRef.current = lockScroll;
    if (entryRef.current) {
      entryRef.current.lock = lockScroll;
      syncDocument();
    }
  }, [lockScroll]);

  useEffect(() => {
    if (!open) return;
    const entry: LayerEntry = { close: () => closeRef.current(), lock: lockRef.current };
    entryRef.current = entry;
    const release = pushLayer(entry);
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? (panel ? focusablesIn(panel)[0] : null);
    first?.focus();
    return () => {
      entryRef.current = null;
      release();
    };
  }, [open, panelRef]);

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
