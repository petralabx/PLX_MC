// Mission Control's keyboard shortcuts in one list (TASK-3958; portal ADR-011
// v2, Keys): the shell's key handler reads VIEW_CHORDS from here, and the ?
// sheet (shortcuts-sheet.tsx) lists every group, so the sheet always matches
// the keys that ship. singleKeysPref turns the single-key ones off (WCAG
// 2.1.4, ADR-011 Keys 8): [, /, ?, the g chords and Shift S. ⌘K takes a
// modifier, and the keys inside a focused control (the tree, the splitter)
// act only there, so both stay.
import { STAR_CAP } from "@/lib/stars";

import { screenTitle, starDigit } from "./nav-model";
import type { Screen } from "./route";
import { createPref } from "./shell-prefs";

/** g then a letter opens a screen (shell.tsx). */
export const VIEW_CHORDS: Readonly<Record<string, Screen>> = {
  b: "board",
  l: "list",
  t: "timeline",
  m: "mine",
  i: "insights",
};

/** Single-key shortcuts on (the default) or off, per browser. */
export const singleKeysPref = createPref<boolean>(
  "mc.keys.single",
  (raw) => raw !== "off",
  (on) => (on ? "on" : "off")
);

export interface ShortcutRow {
  /**
   * Each way to type it: a space separates keys pressed in turn ("g b"), a +
   * keys held together ("Shift+S"). Two entries are alternatives.
   */
  keys: string[];
  what: string;
  /** Off while single-key shortcuts are off. */
  single?: true;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Anywhere",
    rows: [
      { keys: ["⌘+K"], what: "Search, jump to a page or create (Ctrl K on Windows)" },
      { keys: ["?"], what: "These shortcuts", single: true },
      { keys: ["["], what: "Collapse or expand the sidebar (open or close the menu on a narrow screen)", single: true },
      { keys: ["/"], what: "Filter the page, or the projects in the sidebar", single: true },
      { keys: ["Shift+S"], what: "Star or unstar this page", single: true },
      { keys: ["Esc"], what: "Close a menu, panel or dialog" },
    ],
  },
  {
    title: "Go to",
    rows: [
      ...Object.entries(VIEW_CHORDS).map(([key, screen]): ShortcutRow => ({
        keys: [`g ${key}`],
        what: screenTitle(screen),
        single: true,
      })),
      {
        keys: [`g ${starDigit(0)}–${starDigit(STAR_CAP - 2)}`],
        what: "Your first to ninth star",
        single: true,
      },
      { keys: [`g ${starDigit(STAR_CAP - 1)}`], what: "Your tenth star", single: true },
    ],
  },
  {
    title: "In the sidebar",
    rows: [
      { keys: ["↑", "↓"], what: "Move between rows" },
      { keys: ["Home", "End"], what: "First or last row" },
      { keys: ["→", "←"], what: "Open or close a group; go into it or back up" },
      { keys: ["A–Z"], what: "Jump to the next row that starts with that letter" },
      { keys: ["Shift+S"], what: "Star or unstar the row", single: true },
      { keys: ["Alt+↑", "Alt+↓"], what: "Move a starred row" },
      { keys: ["Shift+F10"], what: "The row's menu (the + on Projects)" },
    ],
  },
  {
    title: "On the sidebar's edge",
    rows: [
      { keys: ["←", "→"], what: "Narrower or wider by 16px" },
      { keys: ["Shift+←", "Shift+→"], what: "Narrower or wider by 64px" },
      { keys: ["Home", "End"], what: "Narrowest or widest" },
      { keys: ["Enter"], what: "Collapse to the rail" },
    ],
  },
];
