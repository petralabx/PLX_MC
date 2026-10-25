// The signed-in viewer's menu (TASK-2977): the top-bar avatar opens a small
// popover with who is signed in, the "Try the new navigation" switch
// (TASK-3855, nav-zones.ts) and Sign out. Same behaviour as the filter bar's
// popovers (outside click and Esc close it, focus returns to the trigger), and
// the arrow keys move between the items; skinned in mc-shell.css with the
// .fb-pop paper / grid / ink tokens.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { LogOut, PanelLeft } from "lucide-react";

import { signOutAction } from "@/lib/auth/actions";
import type { Human } from "@/lib/mc-data/types";

import { Avatar } from "./atoms";
import { useNavSwitch } from "./nav-zones";

export function UserMenu({ viewer }: { viewer: Human }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
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
      {open ? (
        <UserMenuPanel
          viewer={viewer}
          onPick={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

// ArrowDown / ArrowUp move between the menu's items, wrapping; Home and End jump.
function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const targets: Record<string, number> = {
    ArrowDown: at < 0 || at === last ? 0 : at + 1,
    ArrowUp: at <= 0 ? last : at - 1,
    Home: 0,
    End: last,
  };
  const next = targets[event.key];
  if (next === undefined) return;
  event.preventDefault();
  items[next].focus();
}

/** The open menu: who is signed in, the navigation switch, then Sign out (a server action). */
export function UserMenuPanel({
  viewer,
  onPick,
}: {
  viewer: Human;
  /** Called when an item opens something over the page (the tour): the menu closes and gives way. */
  onPick?: () => void;
}) {
  const navSwitch = useNavSwitch();
  return (
    <div className="usermenu-pop" id="mc-usermenu" role="menu" aria-label="Account" onKeyDown={moveFocus}>
      <div className="usermenu-who" role="presentation">
        <span className="kk">Signed in</span>
        <span className="nm">{viewer.name}</span>
        {viewer.email ? <span className="em">{viewer.email}</span> : null}
        <span className="rl">{viewer.role}</span>
      </div>
      {navSwitch.offered ? (
        <button
          type="button"
          className="usermenu-item"
          role="menuitemcheckbox"
          aria-checked={navSwitch.on}
          data-testid="nav-switch"
          onClick={() => {
            // The menu stays open to show the switch flip, unless the tour opens over the page.
            if (navSwitch.set(!navSwitch.on)) onPick?.();
          }}
        >
          <PanelLeft className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          Try the new navigation
          <span className="usermenu-switch" aria-hidden="true" />
        </button>
      ) : null}
      <form action={signOutAction} role="none">
        <button type="submit" className="usermenu-item" role="menuitem" data-testid="sign-out">
          <LogOut className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
          Sign out
        </button>
      </form>
    </div>
  );
}
