"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BUCKETS,
  CURRENT_USER,
  PRDS,
  PRIORITY,
  REPOS,
  STAGES,
  STAGE_IDX,
  type PriorityKey,
  type StageKey,
} from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { actorById, addTask, nextTaskId } from "@/lib/mc-data/store";

import { Avatar } from "./atoms";
import { LabelEditor } from "./label-editor";
import { NotifyTrail, PeoplePicker } from "./people-picker";
import type { Nav } from "./route";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDueDate(isoDate: string): string {
  if (!isoDate) return "—";
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`;
}

interface NewTaskContext {
  bucketId?: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="seg ntm-seg">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function NewTaskModal({
  ctx,
  onClose,
  nav,
}: {
  ctx?: NewTaskContext;
  onClose: () => void;
  nav: Nav;
}) {
  useMcVersion();
  const startingBucketId = ctx?.bucketId ?? BUCKETS[0]?.id ?? "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [bucketId, setBucketId] = useState(startingBucketId);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  // EN-003: a human is always accountable; default to the operator authoring it.
  const [accountableId, setAccountableId] = useState<string | null>(CURRENT_USER);
  const [humanOnly, setHumanOnly] = useState(false);
  const [accountablePickerOpen, setAccountablePickerOpen] = useState(false);
  const [priority, setPriority] = useState<PriorityKey>("medium");
  const [stage, setStage] = useState<StageKey>("backlog");
  const [estimate, setEstimate] = useState<"S" | "M" | "L">("M");
  const [dueISO, setDueISO] = useState("");
  const [requirements, setRequirements] = useState<string[]>([]);
  const [repos, setRepos] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => titleRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const bucket = useMemo(() => BUCKETS.find((b) => b.id === bucketId) ?? null, [bucketId]);
  const prd = useMemo(() => (bucket?.prd ? PRDS[bucket.prd] : undefined), [bucket]);
  const owner = ownerId ? actorById(ownerId) : undefined;
  const accountable = accountableId ? actorById(accountableId) : undefined;

  // Turning on human-only drops an already-chosen agent executor so the policy
  // invariant holds before submit (the executor picker also hides agents).
  const toggleHumanOnly = (next: boolean) => {
    setHumanOnly(next);
    if (next && owner?.kind === "agent") setOwnerId(null);
  };
  const repoOptions = useMemo(() => {
    if (bucket?.repos && bucket.repos.length > 0) return bucket.repos;
    return Object.keys(REPOS);
  }, [bucket]);

  const canCreate = title.trim().length > 0 && !!bucketId;
  const handleBucketChange = (nextBucketId: string) => {
    setBucketId(nextBucketId);
    const nextBucket = BUCKETS.find((bucketOption) => bucketOption.id === nextBucketId) ?? null;
    const nextPrd = nextBucket?.prd ? PRDS[nextBucket.prd] : undefined;
    const nextRepoOptions =
      nextBucket?.repos && nextBucket.repos.length > 0 ? nextBucket.repos : Object.keys(REPOS);
    setRequirements((prev) =>
      prev.filter((id) => nextPrd?.reqs.some((requirement) => requirement.id === id) ?? false)
    );
    setRepos((prev) => prev.filter((id) => nextRepoOptions.includes(id)));
  };

  const stageName = STAGES[STAGE_IDX[stage]]?.name ?? "Backlog";
  const nextId = nextTaskId();

  const toggle = (values: string[], value: string, set: (next: string[]) => void) => {
    set(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  const submit = useCallback(() => {
    if (!canCreate || !bucketId) return;
    const created = addTask({
      title,
      description,
      bucket: bucketId,
      assignee: ownerId,
      accountableOwner: accountableId,
      humanOnly,
      priority,
      stage,
      due: formatDueDate(dueISO),
      estimate,
      reqs: requirements,
      repos,
      labels,
      reporter: CURRENT_USER,
    });
    onClose();
    nav("board", { bucketId: created.bucket });
  }, [
    accountableId,
    bucketId,
    canCreate,
    description,
    dueISO,
    estimate,
    humanOnly,
    labels,
    nav,
    onClose,
    ownerId,
    priority,
    repos,
    requirements,
    stage,
    title,
  ]);

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
      <div className="ntm" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Create a new task">
        <div className="ntm-head">
          <div>
            <span className="kk">New task · {nextId}</span>
            <h2>
              Create a <em>task</em>
            </h2>
          </div>
          <button type="button" className="ntm-x" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="ntm-body">
          <input
            ref={titleRef}
            className="ntm-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to be done?"
          />
          <textarea
            className="ntm-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add a description, acceptance notes, or context... (optional)"
            rows={3}
          />

          <div className="ntm-grid">
            <label className="ntm-fact">
              <span className="k">Initiative</span>
              <div className="ntm-select-wrap">
                <select value={bucketId} onChange={(event) => handleBucketChange(event.target.value)}>
                  {BUCKETS.map((bucketOption) => (
                    <option key={bucketOption.id} value={bucketOption.id}>
                      {bucketOption.name}
                    </option>
                  ))}
                </select>
                <span className="caret">▾</span>
              </div>
            </label>

            <div className="ntm-fact">
              <span className="k">Accountable owner</span>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="ntm-field-btn"
                  onClick={() => setAccountablePickerOpen((prev) => !prev)}
                >
                  {accountable ? (
                    <span className="who" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <Avatar id={accountable.id} size="sm" />
                      <span className="nm">{accountable.name}</span>
                    </span>
                  ) : (
                    <span className="unassigned">+ Assign accountable owner</span>
                  )}
                  <span className="caret">▾</span>
                </button>
                {accountablePickerOpen ? (
                  <PeoplePicker
                    // Accountability is always human (EN-003) — no agents.
                    allowAgents={false}
                    current={accountableId}
                    onPick={setAccountableId}
                    onClose={() => setAccountablePickerOpen(false)}
                    style={{ top: "100%", left: 0, marginTop: 5, minWidth: "100%" }}
                  />
                ) : null}
              </div>
            </div>

            <div className="ntm-fact">
              <span className="k">Executor</span>
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
                      {owner.kind === "agent" ? <span className="tag model">{owner.model}</span> : null}
                    </span>
                  ) : (
                    <span className="unassigned">+ Assign executor</span>
                  )}
                  <span className="caret">▾</span>
                </button>
                {ownerPickerOpen ? (
                  <PeoplePicker
                    // Human-only tasks hide agents (EN-003 policy via allowAgents).
                    allowAgents={!humanOnly}
                    current={ownerId}
                    onPick={setOwnerId}
                    onClose={() => setOwnerPickerOpen(false)}
                    style={{ top: "100%", left: 0, marginTop: 5, minWidth: "100%" }}
                  />
                ) : null}
              </div>
              <label className="ntm-humanonly">
                <input
                  type="checkbox"
                  checked={humanOnly}
                  onChange={(event) => toggleHumanOnly(event.target.checked)}
                />
                <span>Human-only — agents can&apos;t execute</span>
              </label>
              <NotifyTrail id={ownerId} />
            </div>

            <div className="ntm-fact">
              <span className="k">Priority</span>
              <Segmented
                value={priority}
                onChange={setPriority}
                options={Object.entries(PRIORITY).map(([key, value]) => ({
                  value: key as PriorityKey,
                  label: value.label,
                }))}
              />
            </div>

            <label className="ntm-fact">
              <span className="k">Stage</span>
              <div className="ntm-select-wrap">
                <select value={stage} onChange={(event) => setStage(event.target.value as StageKey)}>
                  {STAGES.map((stageOption) => (
                    <option key={stageOption.key} value={stageOption.key}>
                      {stageOption.n} · {stageOption.name}
                    </option>
                  ))}
                </select>
                <span className="caret">▾</span>
              </div>
            </label>

            <label className="ntm-fact">
              <span className="k">Due</span>
              <div className="ntm-select-wrap">
                <input type="date" value={dueISO} onChange={(event) => setDueISO(event.target.value)} />
              </div>
            </label>

            <div className="ntm-fact">
              <span className="k">Estimate</span>
              <Segmented
                value={estimate}
                onChange={setEstimate}
                options={[
                  { value: "S", label: "S" },
                  { value: "M", label: "M" },
                  { value: "L", label: "L" },
                ]}
              />
            </div>
          </div>

          {prd?.reqs.length ? (
            <div className="ntm-chips">
              <span className="k">
                PRD requirements <span className="via">via {prd.id}</span>
              </span>
              <div className="row">
                {prd.reqs.map((requirement) => (
                  <button
                    type="button"
                    key={requirement.id}
                    title={requirement.text}
                    className={`ntm-chip req${requirements.includes(requirement.id) ? " on" : ""}`}
                    onClick={() => toggle(requirements, requirement.id, setRequirements)}
                  >
                    {requirement.id}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="ntm-chips">
            <span className="k">Repos</span>
            <div className="row">
              {repoOptions.map((repoId) => (
                <button
                  type="button"
                  key={repoId}
                  className={`ntm-chip repo${repos.includes(repoId) ? " on" : ""}`}
                  onClick={() => toggle(repos, repoId, setRepos)}
                >
                  {REPOS[repoId].name}
                </button>
              ))}
            </div>
          </div>

          <div className="ntm-chips">
            <span className="k">Labels</span>
            <LabelEditor labels={labels} onChange={setLabels} />
          </div>
        </div>

        <div className="ntm-foot">
          <span className="ntm-hint">
            Lands in <b>{stageName}</b> · mirrors{" "}
            <span className="sync pending">
              <span className="d" />
              Pending
            </span>{" "}
            to the record
          </span>
          <div className="ntm-acts">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn acc" disabled={!canCreate} onClick={submit}>
              Create task →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
