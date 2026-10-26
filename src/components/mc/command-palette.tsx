"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { AGENTS, isClosedStage } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  allBuckets,
  allProjects,
  allTasks,
  assignableViewerId,
  navBuckets,
  navProjects,
  pushNotice,
  reassignTask,
  setTaskStage,
} from "@/lib/mc-data/store";
import { meetingIntakeEnabled } from "@/lib/meeting-intake";

import { RECENTS_CAP, createRecents, navCommands, recentKeyOf, starDigit, starKeyOf, type RecentKey } from "./nav-model";
import { useNavZones } from "./nav-zones";
import type { Nav, Route } from "./route";
import { routingInboxEnabled } from "./routing-inbox/flag";
import { useStars } from "./use-stars";

export interface PaletteItem {
  key: string;
  icon: string;
  label: string;
  hint?: string;
}

export interface PaletteGroup<T extends PaletteItem> {
  title: string;
  items: T[];
}

export function filterPaletteGroups<T extends PaletteItem>(
  groups: PaletteGroup<T>[],
  query: string
): PaletteGroup<T>[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = `${item.label} ${item.hint ?? ""}`.toLowerCase();
        return haystack.includes(normalized);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

interface PaletteCommand extends PaletteItem {
  run: () => void;
}

// Recents (TASK-3853): the pages the zoned shell opened last, in this browser,
// as the phone tabs' memory is (bottom-tabs.tsx). The palette mounts only when
// someone opens it, never in the server's HTML, so one snapshot serves both.
const browserStorage = () => (typeof window === "undefined" ? null : window.localStorage);
let recents = createRecents(browserStorage);

/** Called by the shell each time the zoned shell opens a page. */
export function rememberRecent(key: RecentKey) {
  recents.visit(key);
}

/** Tests only: forget the recents. */
export function __resetRecentsForTests() {
  recents = createRecents(browserStorage);
}

/**
 * The command a recent or starred key opens: a screen's Go to, or the record's
 * own row. A closed or archived project or initiative, left out of the
 * palette's lists, still resolves: it may be starred, or just opened.
 */
function recordCommand(key: string, listed: ReadonlyMap<string, PaletteCommand>, nav: Nav): PaletteCommand | undefined {
  if (key.startsWith("screen:")) return listed.get(`nav:${key.slice("screen:".length)}`);
  const own = listed.get(key);
  if (own) return own;
  const id = key.slice(key.indexOf(":") + 1);
  if (key.startsWith("project:")) {
    const project = allProjects().find((p) => p.id === id);
    return project
      ? { key, icon: "◫", label: `Project · ${project.name}`, hint: project.id, run: () => nav("project", { projectId: id }) }
      : undefined;
  }
  if (key.startsWith("bucket:")) {
    const bucket = allBuckets().find((b) => b.id === id);
    return bucket
      ? { key, icon: "●", label: `Initiative · ${bucket.name}`, hint: bucket.id, run: () => nav("bucket", { bucketId: id }) }
      : undefined;
  }
  return undefined;
}

export function CommandPalette({
  onClose,
  nav,
  route,
  onOpenNewTask,
  onOpenNewInitiative,
  onOpenNewProject,
  onEditStarred,
}: {
  onClose: () => void;
  nav: Nav;
  /** The page the palette opened over: left out of Recent. */
  route?: Route;
  onOpenNewTask: () => void;
  onOpenNewInitiative: () => void;
  onOpenNewProject: () => void;
  /** The zoned shell's Edit starred: focus the starred copies (TASK-3956). */
  onEditStarred?: () => void;
}) {
  const version = useMcVersion();
  const zoned = useNavZones();
  const recentKeys = useSyncExternalStore(recents.subscribe, recents.list, recents.list);
  const stars = useStars(zoned);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `version` is load-bearing: bucket/task commands read the live store, so a
  // store mutation while the palette is open must recompute the groups.
  const groups = useMemo<PaletteGroup<PaletteCommand>[]>(() => {
    void version;
    const tasks = allTasks();
    const me = assignableViewerId();
    const firstBucket = navBuckets()[0]?.id;
    const firstTask = tasks[0]?.id;
    const firstProject = navProjects()[0]?.id;
    const create: PaletteCommand[] = [
      { key: "create:new-task", icon: "+", label: "New task", hint: "create", run: onOpenNewTask },
      { key: "create:new-project", icon: "+", label: "New project", hint: "create", run: onOpenNewProject },
      { key: "create:new-bucket", icon: "+", label: "New initiative", hint: "create", run: onOpenNewInitiative },
    ];

    // Screen jumps come from the shared nav model (nav-model.ts) — the same
    // groups, labels and flags as the sidebar; the three detail jumps follow.
    const navigate: PaletteCommand[] = [
      ...navCommands({ meetingIntake: meetingIntakeEnabled(), routingInbox: routingInboxEnabled() }, zoned).map(
        ({ screen, ...command }) => ({ ...command, run: () => nav(screen) })
      ),
      {
        key: "nav:project",
        icon: "◫",
        label: "Go to Project detail",
        hint: firstProject ?? "no projects",
        run: () => {
          if (firstProject) nav("project", { projectId: firstProject });
        },
      },
      {
        key: "nav:bucket",
        icon: "●",
        label: "Go to Initiative detail",
        hint: firstBucket ?? "no initiatives",
        run: () => {
          if (firstBucket) nav("bucket", { bucketId: firstBucket });
        },
      },
      {
        key: "nav:task",
        icon: "▸",
        label: "Go to Task detail",
        hint: firstTask ?? "no tasks",
        run: () => {
          if (firstTask) nav("task", { taskId: firstTask });
        },
      },
    ];

    const projects: PaletteCommand[] = navProjects().map((project) => ({
      key: `project:${project.id}`,
      icon: "◫",
      label: `Project · ${project.name}`,
      hint: project.id,
      run: () => nav("project", { projectId: project.id }),
    }));

    const buckets: PaletteCommand[] = navBuckets().map((bucket) => ({
      key: `bucket:${bucket.id}`,
      icon: "●",
      label: `Initiative · ${bucket.name}`,
      hint: bucket.id,
      run: () => nav("bucket", { bucketId: bucket.id }),
    }));

    // Per-task commands: the "go to detail" navigate (existing) plus two REAL
    // spine-backed actions (Module G, SPEC §3.G.2) replacing the former dead
    // create/agent stubs. Both route through the FROZEN spine wrappers
    // (setTaskStage / reassignTask → patchTaskFields → optimistic + PATCH +
    // reconcile/rollback + notice), so no new store code and no half-wire.
    // "Done" = the `verified` stage (band=done); "to me" = the signed-in viewer
    // (only when they are in the directory — an unlisted viewer can't be assigned).
    // Already-done / already-mine are handled by HIDING the action (a per-task
    // command rebuilt from `tasks`), so the palette never offers a no-op.
    const taskCommands: PaletteCommand[] = tasks.flatMap((task) => {
      const commands: PaletteCommand[] = [
        {
          key: `task:${task.id}`,
          icon: "▸",
          label: `${task.id} · ${task.title}`,
          hint: "task",
          run: () => nav("task", { taskId: task.id }),
        },
      ];
      const isDone = isClosedStage(task.stage);
      if (!isDone) {
        commands.push({
          key: `task-done:${task.id}`,
          icon: "✓",
          label: `Mark ${task.id} done`,
          hint: "task action",
          run: () => setTaskStage(task.id, "verified"), // band=done; spine wrapper
        });
      }
      if (me && task.assignee !== me) {
        commands.push({
          key: `assign-me:${task.id}`,
          icon: "☺",
          label: `Assign ${task.id} to me`,
          hint: "task action",
          run: () => reassignTask(task.id, me), // spine wrapper; honest deferred-mirror copy
        });
      }
      return commands;
    });

    // Assign an agent to the first OPEN, agent-eligible task (unassigned, not
    // human-only, not yet done) via the real reassignTask spine (EN-005 — replaces
    // the former no-op). reassignTask enforces the human-only policy; a notice
    // fires when nothing qualifies, so the command is never a silent no-op.
    const assignAgents: PaletteCommand[] = Object.values(AGENTS).map((agent) => ({
      key: `assign:${agent.id}`,
      icon: "◧",
      label: `Assign open task to ${agent.name}`,
      hint: agent.model,
      run: () => {
        const open = tasks.find(
          (t) => !t.assignee && !t.humanOnly && !isClosedStage(t.stage)
        );
        if (open) reassignTask(open.id, agent.id);
        else pushNotice(`No open, agent-eligible task to assign to ${agent.name}.`, "info");
      },
    }));

    return [
      { title: "Create", items: create },
      { title: "Navigate", items: navigate },
      { title: "Projects", items: projects },
      { title: "Initiatives", items: buckets },
      { title: "Tasks", items: taskCommands },
      { title: "Assign agents", items: assignAgents },
    ];
  }, [nav, onOpenNewTask, onOpenNewInitiative, version, zoned]);

  // Star this page and Edit starred (portal ADR-011 v2, Starred 4), zoned only.
  // They close the Starred group the palette opens on, and once the person types
  // they are searched in a Starred group after Create. Kept out of the memo
  // above, so a star does not rebuild every command.
  const toggleStar = stars.toggle;
  const pageStar = zoned && route && stars.ready && !stars.off ? starKeyOf(route) : null;
  const pageStarred = pageStar ? stars.starred(pageStar) : false;
  const canEditStarred = zoned && !!onEditStarred && stars.rows.length > 0;
  const starCommands = useMemo(
    (): PaletteCommand[] => [
      ...(pageStar
        ? [
            {
              key: "star:this-page",
              icon: "★",
              label: pageStarred ? "Unstar this page" : "Star this page",
              hint: "Shift S",
              run: () => toggleStar(pageStar),
            },
          ]
        : []),
      ...(canEditStarred && onEditStarred
        ? [{ key: "star:edit", icon: "★", label: "Edit starred", hint: "Alt ↑ ↓ to move", run: onEditStarred }]
        : []),
    ],
    [pageStar, pageStarred, canEditStarred, onEditStarred, toggleStar]
  );

  // The zoned shell opens on Recent and Starred (TASK-3853), until the person
  // types: then every group is searched as before. Starred lists the stars in
  // their order, with the g then digit keys that open them (1 to 9, 0 for the tenth).
  const currentKey = route ? recentKeyOf(route) : null;
  const leading = useMemo<PaletteGroup<PaletteCommand>[]>(() => {
    if (!zoned) return [];
    const listed = new Map(groups.flatMap((group) => group.items).map((item) => [item.key, item]));
    const recent = recentKeys
      .flatMap((key): PaletteCommand[] => {
        const command = key === currentKey ? undefined : recordCommand(key, listed, nav);
        return command ? [{ ...command, key: `recent:${key}` }] : [];
      })
      .slice(0, RECENTS_CAP);
    const starred = stars.rows.flatMap((row): PaletteCommand[] => {
      const command = row.mark === "gone" ? undefined : recordCommand(row.key, listed, nav);
      if (!command) return [];
      // A screen star reads as its zoned row does (All work, not Board).
      const label = row.key.startsWith("screen:") ? `Go to ${row.label}` : command.label;
      return [{ ...command, key: `star:${row.key}`, label, hint: `g ${starDigit(row.slot)}` }];
    });
    return [
      { title: "Recent", items: recent },
      { title: "Starred", items: [...starred, ...starCommands] },
    ].filter((group) => group.items.length > 0);
  }, [zoned, groups, recentKeys, currentKey, stars.rows, nav, starCommands]);

  const filtered = useMemo(() => {
    if (!query.trim()) return [...leading, ...groups];
    const searched = starCommands.length > 0 ? [groups[0], { title: "Starred", items: starCommands }, ...groups.slice(1)] : groups;
    return filterPaletteGroups(searched, query);
  }, [groups, leading, query, starCommands]);
  const flat = useMemo(() => filtered.flatMap((group) => group.items), [filtered]);
  const selectedIndex = flat.length === 0 ? 0 : Math.min(selected, flat.length - 1);
  const indexedGroups = useMemo(() => {
    let index = 0;
    return filtered.map((group) => ({
      title: group.title,
      rows: group.items.map((item) => ({ item, index: index++ })),
    }));
  }, [filtered]);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowDown") {
        if (flat.length === 0) return;
        event.preventDefault();
        setSelected((prev) => Math.min(flat.length - 1, prev + 1));
        return;
      }

      if (event.key === "ArrowUp") {
        if (flat.length === 0) return;
        event.preventDefault();
        setSelected((prev) => Math.max(0, prev - 1));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const command = flat[selectedIndex];
        if (!command) return;
        command.run();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flat, onClose, selectedIndex]);

  return (
    <div className="mc-cmdk-overlay" onClick={onClose}>
      <div className="mc-cmdk" data-testid="cmdk" onClick={(event) => event.stopPropagation()}>
        <div className="cin">
          <span className="pre">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            placeholder="Create a task, jump to an initiative, assign an agent..."
            aria-label="Command palette search"
          />
          <span className="esc">ESC</span>
        </div>

        {/* Scrollable results need keyboard reachability (axe
            scrollable-region-focusable) — same tabindex idiom as gs-pre. */}
        <div className="cmd-results" tabIndex={0} role="group" aria-label="Command results">
          {flat.length === 0 ? (
            <div className="cgrp">
              <div className="cres empty">No matches</div>
            </div>
          ) : null}

          {indexedGroups.map((group) => (
            <div className="cgrp" key={group.title}>
              <div className="gh">{group.title}</div>
              {group.rows.map(({ item, index }) => {
                return (
                  <div
                    key={item.key}
                    className={`cres${selectedIndex === index ? " on" : ""}`}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => {
                      item.run();
                      onClose();
                    }}
                  >
                    <span className="ic">{item.icon}</span>
                    <span>{item.label}</span>
                    {item.hint ? <span className="hint">{item.hint}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
