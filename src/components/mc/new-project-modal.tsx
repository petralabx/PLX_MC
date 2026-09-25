"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Project } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { actorById, addProject, allRepos, assignableViewerId } from "@/lib/mc-data/store";

import { Avatar } from "./atoms";
import { PeoplePicker } from "./people-picker";
import type { Nav } from "./route";

const HEALTH_OPTIONS: Array<{ value: Project["health"]; label: string }> = [
  { value: "track", label: "On track" },
  { value: "risk", label: "At risk" },
  { value: "off", label: "Off track" },
];

export function NewProjectModal({ onClose, nav }: { onClose: () => void; nav: Nav }) {
  useMcVersion();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(assignableViewerId);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [health, setHealth] = useState<Project["health"]>("track");
  const [target, setTarget] = useState("");
  const [repos, setRepos] = useState<string[]>([]);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => nameRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const registry = allRepos();
  const owner = ownerId ? actorById(ownerId) : undefined;
  const canCreate = name.trim().length > 0;

  const toggleRepo = (repoId: string) => {
    setRepos((prev) => (prev.includes(repoId) ? prev.filter((id) => id !== repoId) : [...prev, repoId]));
  };

  const submit = useCallback(() => {
    if (!canCreate) return;
    const created = addProject({
      name,
      owner: ownerId ?? undefined,
      health,
      target,
      desc: description,
      repos,
    });
    onClose();
    nav("project", { projectId: created.id });
  }, [canCreate, name, ownerId, health, target, description, repos, onClose, nav]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submit]);

  return (
    <div className="ntm-overlay" onClick={onClose}>
      <div
        className="ntm"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Create a new project"
      >
        <div className="ntm-head">
          <div>
            <span className="kk">New project</span>
            <h2>
              Create a <em>project</em>
            </h2>
          </div>
          <button type="button" className="ntm-x" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="ntm-body">
          <input
            ref={nameRef}
            className="ntm-title"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this project…"
          />
          <textarea
            className="ntm-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this project about? (optional)"
            rows={3}
          />

          <div className="ntm-grid">
            <div className="ntm-fact">
              <span className="k">Accountable owner</span>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="ntm-field-btn"
                  onClick={() => setOwnerPickerOpen((prev) => !prev)}
                >
                  {owner ? (
                    <span className="who" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <Avatar id={owner.id} size="sm" />
                      <span className="nm">{owner.name}</span>
                    </span>
                  ) : (
                    <span className="unassigned">+ Assign accountable owner</span>
                  )}
                  <span className="caret">▾</span>
                </button>
                {ownerPickerOpen ? (
                  <PeoplePicker
                    allowAgents={false}
                    current={ownerId}
                    onPick={setOwnerId}
                    onClose={() => setOwnerPickerOpen(false)}
                    style={{ top: "100%", left: 0, marginTop: 5, minWidth: "100%" }}
                  />
                ) : null}
              </div>
            </div>

            <div className="ntm-fact">
              <span className="k">Health</span>
              <div className="seg ntm-seg">
                {HEALTH_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={health === option.value ? "on" : ""}
                    onClick={() => setHealth(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="ntm-fact">
              <span className="k">Target</span>
              <div className="ntm-select-wrap">
                <input
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder="e.g. Oct 01"
                />
              </div>
            </label>
          </div>

          <div className="ntm-chips">
            <span className="k">Repos</span>
            <div className="row">
              {Object.keys(registry).map((repoId) => (
                <button
                  type="button"
                  key={repoId}
                  className={`ntm-chip repo${repos.includes(repoId) ? " on" : ""}`}
                  onClick={() => toggleRepo(repoId)}
                >
                  {registry[repoId]?.name ?? repoId}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ntm-foot">
          <span className="ntm-hint">
            Persists to Mission Control · mirrors{" "}
            <span className="sync pending">
              <span className="d" />
              Pending
            </span>{" "}
            to the Projects list
          </span>
          <div className="ntm-acts">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn acc" disabled={!canCreate} onClick={submit}>
              Create project →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
