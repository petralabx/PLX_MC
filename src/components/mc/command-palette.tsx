"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AGENTS, CURRENT_USER } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allBuckets, allTasks, pushNotice, reassignTask, setTaskStage } from "@/lib/mc-data/store";

import type { Nav } from "./route";

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

export function CommandPalette({
  onClose,
  nav,
  onOpenNewTask,
  onOpenNewInitiative,
}: {
  onClose: () => void;
  nav: Nav;
  onOpenNewTask: () => void;
  onOpenNewInitiative: () => void;
}) {
  const version = useMcVersion();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `version` is load-bearing: bucket/task commands read the live store, so a
  // store mutation while the palette is open must recompute the groups.
  const groups = useMemo<PaletteGroup<PaletteCommand>[]>(() => {
    void version;
    const tasks = allTasks();
    const firstBucket = allBuckets()[0]?.id;
    const firstTask = tasks[0]?.id;
    const create: PaletteCommand[] = [
      { key: "create:new-task", icon: "+", label: "New task", hint: "create", run: onOpenNewTask },
      { key: "create:new-bucket", icon: "+", label: "New initiative", hint: "create", run: onOpenNewInitiative },
    ];

    const navigate: PaletteCommand[] = [
      { key: "nav:home", icon: "⌂", label: "Go to Inbox", run: () => nav("home") },
      { key: "nav:board", icon: "▦", label: "Go to Board", run: () => nav("board") },
      { key: "nav:list", icon: "≣", label: "Go to List", run: () => nav("list") },
      { key: "nav:timeline", icon: "▭", label: "Go to Timeline", run: () => nav("timeline") },
      { key: "nav:mine", icon: "☉", label: "Go to My Tasks", run: () => nav("mine") },
      { key: "nav:insights", icon: "◔", label: "Go to Insights", run: () => nav("insights") },
      { key: "nav:matrix", icon: "⊞", label: "Go to Traceability", run: () => nav("matrix") },
      { key: "nav:feed", icon: "◉", label: "Go to Agent activity", run: () => nav("feed") },
      {
        key: "nav:bucket",
        icon: "●",
        label: "Go to Initiative detail",
        hint: firstBucket ?? "no initiatives",
        run: () => {
          if (firstBucket) nav("bucket", { bucketId: firstBucket });
        },
      },
      { key: "nav:repos", icon: "❮❯", label: "Go to Repos", run: () => nav("repos") },
      { key: "nav:files", icon: "❒", label: "Go to Files", run: () => nav("files") },
      { key: "nav:sync", icon: "⇄", label: "Go to Sync console", run: () => nav("sync") },
      { key: "nav:loop-ledgers", icon: "◰", label: "Go to Loop ledgers", run: () => nav("loop-ledgers") },
      { key: "nav:governance-sops", icon: "§", label: "Go to SOP guide", run: () => nav("governance-sops") },
      { key: "nav:skills-directory", icon: "◈", label: "Go to Skills directory", run: () => nav("skills-directory") },
      { key: "nav:ai-spend", icon: "◎", label: "Go to AI Spend", run: () => nav("ai-spend") },
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

    const buckets: PaletteCommand[] = allBuckets().map((bucket) => ({
      key: `bucket:${bucket.id}`,
      icon: "●",
      label: `Bucket · ${bucket.name}`,
      hint: bucket.id,
      run: () => nav("bucket", { bucketId: bucket.id }),
    }));

    // Per-task commands: the "go to detail" navigate (existing) plus two REAL
    // spine-backed actions (Module G, SPEC §3.G.2) replacing the former dead
    // create/agent stubs. Both route through the FROZEN spine wrappers
    // (setTaskStage / reassignTask → patchTaskFields → optimistic + PATCH +
    // reconcile/rollback + notice), so no new store code and no half-wire.
    // "Done" = the `verified` stage (band=done); "to me" = CURRENT_USER.
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
      const isDone = task.stage === "verified" || task.stage === "merged";
      if (!isDone) {
        commands.push({
          key: `task-done:${task.id}`,
          icon: "✓",
          label: `Mark ${task.id} done`,
          hint: "task action",
          run: () => setTaskStage(task.id, "verified"), // band=done; spine wrapper
        });
      }
      if (task.assignee !== CURRENT_USER) {
        commands.push({
          key: `assign-me:${task.id}`,
          icon: "☺",
          label: `Assign ${task.id} to me`,
          hint: "task action",
          run: () => reassignTask(task.id, CURRENT_USER), // spine wrapper; honest deferred-mirror copy
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
          (t) => !t.assignee && !t.humanOnly && t.stage !== "merged" && t.stage !== "verified"
        );
        if (open) reassignTask(open.id, agent.id);
        else pushNotice(`No open, agent-eligible task to assign to ${agent.name}.`, "info");
      },
    }));

    return [
      { title: "Create", items: create },
      { title: "Navigate", items: navigate },
      { title: "Buckets", items: buckets },
      { title: "Tasks", items: taskCommands },
      { title: "Assign agents", items: assignAgents },
    ];
  }, [nav, onOpenNewTask, onOpenNewInitiative, version]);

  const filtered = useMemo(() => filterPaletteGroups(groups, query), [groups, query]);
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
            placeholder="Create a task, jump to a bucket, assign an agent..."
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
