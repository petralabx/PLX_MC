// The signed-in viewer's menu (TASK-2977): the top-bar avatar opens a small
// popover with who is signed in and Sign out. Same behaviour as the filter
// bar's popovers (outside click and Esc close it, focus returns to the
// trigger); skinned in mc-shell.css with the .fb-pop paper / grid / ink tokens.
import { useEffect, useRef, useState, type RefObject } from "react";
import { LogOut } from "lucide-react";

import { signOutAction } from "@/lib/auth/actions";
import type { Human } from "@/lib/mc-data/types";

import { Avatar } from "./atoms";

export function UserMenu({ viewer }: { viewer: Human }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const firstItem = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const close = (refocus: boolean) => {
      setOpen(false);
      if (refocus) trigger.current?.focus();
    };
    const onPointer = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) close(false);
    };
    // Capture + stopPropagation so Esc closes only this menu, not a screen behind it.
    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onEsc, true);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onEsc, true);
    };
  }, [open]);

  return (
    <div className="usermenu" ref={wrap}>
      <button
        type="button"
        ref={trigger}
        className="usermenu-trigger"
        aria-label={`Account: ${viewer.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "mc-usermenu" : undefined}
        data-testid="user-menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Avatar actor={viewer} id={viewer.id} size="lg" title={`${viewer.name} · ${viewer.role}`} />
      </button>
      {open ? <UserMenuPanel viewer={viewer} firstItemRef={firstItem} /> : null}
    </div>
  );
}

/** The open menu: who is signed in, then Sign out (a server action). */
export function UserMenuPanel({
  viewer,
  firstItemRef,
}: {
  viewer: Human;
  firstItemRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="usermenu-pop" id="mc-usermenu" role="menu" aria-label="Account">
      <div className="usermenu-who" role="presentation">
        <span className="kk">Signed in</span>
        <span className="nm">{viewer.name}</span>
        {viewer.email ? <span className="em">{viewer.email}</span> : null}
        <span className="rl">{viewer.role}</span>
      </div>
      <form action={signOutAction} role="none">
        <button type="submit" ref={firstItemRef} className="usermenu-item" role="menuitem" data-testid="sign-out">
          <LogOut className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          Sign out
        </button>
      </form>
    </div>
  );
}
