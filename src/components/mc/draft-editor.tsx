"use client";

// The New draft form (TASK-4109; PRD "Follow-up: New draft form"). A signed-in
// person writes a draft on the Drafts screen instead of through their agent:
// `?screen=drafts&draftId=new` starts one, and `&draftId=DRF-n&edit=1` edits one
// they author. The form covers who sees and reviews the draft, the plan, and
// the research submit needs. Risks, open questions and artifacts are not in the
// form yet (TASK-4110); a save sends them back as they were. Each save and
// submit names the edit base the form was read with, so a draft that moved
// meanwhile (an agent's save, another tab) refuses it instead of being
// overwritten. The server validates; the form only drops rows left empty.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { api, ApiClientError } from "@/lib/api";
import {
  emptyDraftContent,
  type DraftApproach,
  type DraftContent,
  type DraftFinding,
  type DraftIssue,
  type DraftPlan,
  type DraftPlanBucket,
  type DraftPlanTask,
  type DraftResearch,
  type DraftSource,
} from "@/lib/drafts";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allRepos, directory, pickerProjects } from "@/lib/mc-data/store";
import { TASK_KINDS } from "@/lib/tasks/kind-labels";

import type { DraftDetail } from "./drafts";
import { setNavGuard } from "./nav-guard";
import type { Nav } from "./route";

interface FormState {
  content: DraftContent;
  visibility: "shared" | "restricted";
  /** As typed: emails or directory ids, separated by commas. */
  members: string;
  reviewers: string;
}

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const LEVELS = ["low", "medium", "high"] as const;
const EFFORTS = ["S", "M", "L"] as const;

const splitList = (text: string) =>
  text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
const tidy = (items: string[]) => items.map((s) => s.trim()).filter(Boolean);
const nextNumber = (values: string[]) => Math.max(0, ...values.map((v) => Number(v.replace(/\D/g, "")) || 0)) + 1;
const at = <T,>(list: T[], i: number, patch: Partial<T>): T[] => list.map((item, j) => (j === i ? { ...item, ...patch } : item));

function blankForm(): FormState {
  return { content: emptyDraftContent(""), visibility: "shared", members: "", reviewers: "" };
}

function formFrom(detail: DraftDetail): FormState {
  const { draft } = detail;
  return {
    content: draft.working,
    visibility: draft.visibility,
    members: draft.members.join(", "),
    reviewers: draft.reviewers.join(", "),
  };
}

/** The request body for a save, or what the person must fix first. */
function prepare(form: FormState): { body: Record<string, unknown>; problems: string[] } {
  const problems: string[] = [];
  const { content } = form;
  const title = content.title.trim();
  if (!title) problems.push("Give the draft a title.");
  if (content.plan.project.existing === "") problems.push("Choose the existing project, or plan a new one.");
  const approaches = content.research.approaches
    .map((a) => ({ ...a, name: a.name.trim(), pros: tidy(a.pros), cons: tidy(a.cons) }))
    .filter((a) => a.name || a.pros.length > 0 || a.cons.length > 0);
  approaches.forEach((a, i) => {
    if (!a.name) problems.push(`Approach ${i + 1} needs a name.`);
  });
  const findings = content.research.findings.map((f) => ({ ...f, text: f.text.trim() })).filter((f) => f.text || f.sources.length > 0);
  findings.forEach((f, i) => {
    if (!f.text) problems.push(`Finding ${i + 1} needs its text.`);
  });
  const plan: DraftPlan = {
    ...content.plan,
    tasks: content.plan.tasks.map((t) => ({ ...t, dependsOn: tidy(t.dependsOn) })),
  };
  const research: DraftResearch = { ...content.research, approaches, findings };
  return {
    body: { title, plan, research, visibility: form.visibility, members: splitList(form.members), reviewers: splitList(form.reviewers) },
    problems,
  };
}

function errorOf(err: unknown): { code: string; message: string } {
  if (err instanceof ApiClientError) return { code: err.code, message: err.message };
  return { code: "error", message: err instanceof Error ? err.message : "Something went wrong." };
}

// ─── Fields ──────────────────────────────────────────────────────────────────

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`dr-edit-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A person by directory id. A value the directory does not hold (an email an agent wrote) stays a choice. */
function PersonSelect({ label, value, onChange, empty }: { label: string; value: string; onChange: (id: string) => void; empty: string }) {
  const people = directory();
  const listed = people.some((p) => p.id === value);
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{empty}</option>
        {value && !listed && <option value={value}>{value}</option>}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function RepoChips({ label, value, onChange }: { label: string; value: string[]; onChange: (repos: string[]) => void }) {
  const registry = allRepos();
  const ids = [...new Set([...Object.keys(registry), ...value])];
  if (ids.length === 0) return null;
  return (
    <fieldset className="dr-edit-chips wide">
      <legend>{label}</legend>
      {ids.map((repoId) => {
        const on = value.includes(repoId);
        return (
          <button
            type="button"
            key={repoId}
            className={`dr-chip${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((r) => r !== repoId) : [...value, repoId])}
          >
            {registry[repoId]?.name ?? repoId}
          </button>
        );
      })}
    </fieldset>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (value: T) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function SettingsFields({ form, setForm }: { form: FormState; setForm: (fn: (f: FormState) => FormState) => void }) {
  const visibilityName = useId();
  const peopleList = useId();
  return (
    <section className="dr-section dr-edit" aria-label="Draft settings">
      <h2>Draft</h2>
      <div className="dr-edit-grid">
        <Field label="Title" wide>
          <input
            value={form.content.title}
            maxLength={255}
            onChange={(e) => setForm((f) => ({ ...f, content: { ...f.content, title: e.target.value } }))}
          />
        </Field>
        <fieldset className="dr-edit-radios wide">
          <legend>Who can see it</legend>
          <label>
            <input
              type="radio"
              name={visibilityName}
              checked={form.visibility === "shared"}
              onChange={() => setForm((f) => ({ ...f, visibility: "shared" }))}
            />{" "}
            Shared: everyone in Mission Control
          </label>
          <label>
            <input
              type="radio"
              name={visibilityName}
              checked={form.visibility === "restricted"}
              onChange={() => setForm((f) => ({ ...f, visibility: "restricted" }))}
            />{" "}
            Restricted: you and the members
          </label>
        </fieldset>
        <Field label="Members of a restricted draft (emails or directory ids, separated by commas)" wide>
          <input value={form.members} list={peopleList} onChange={(e) => setForm((f) => ({ ...f, members: e.target.value }))} />
        </Field>
        <Field label="Reviewers (directory ids or emails, separated by commas)" wide>
          <input value={form.reviewers} list={peopleList} onChange={(e) => setForm((f) => ({ ...f, reviewers: e.target.value }))} />
        </Field>
        <datalist id={peopleList}>
          {directory().map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </datalist>
      </div>
    </section>
  );
}

function PlanFields({ plan, setPlan }: { plan: DraftPlan; setPlan: (fn: (p: DraftPlan) => DraftPlan) => void }) {
  const modeName = useId();
  const { project, buckets, tasks } = plan;
  const existing = project.existing !== null;
  const setProject = (patch: Partial<DraftPlan["project"]>) => setPlan((p) => ({ ...p, project: { ...p.project, ...patch } }));
  const setBucket = (i: number, patch: Partial<DraftPlanBucket>) => setPlan((p) => ({ ...p, buckets: at(p.buckets, i, patch) }));
  const setTask = (i: number, patch: Partial<DraftPlanTask>) => setPlan((p) => ({ ...p, tasks: at(p.tasks, i, patch) }));

  const addBucket = () =>
    setPlan((p) => ({
      ...p,
      buckets: [...p.buckets, { key: `B${nextNumber(p.buckets.map((b) => b.key))}`, name: "", owner: "", repos: [], desc: "" }],
    }));
  const addTask = () =>
    setPlan((p) => ({
      ...p,
      tasks: [
        ...p.tasks,
        {
          key: `T${nextNumber(p.tasks.map((t) => t.key))}`,
          bucket: p.buckets[0]?.key ?? "B1",
          title: "",
          description: "",
          priority: "medium",
          kind: "code",
          repos: [],
          accountableOwner: null,
          dependsOn: [],
        },
      ],
    }));
  // A removed task leaves the dependency lists of the others.
  const removeTask = (key: string) =>
    setPlan((p) => ({
      ...p,
      tasks: p.tasks.filter((t) => t.key !== key).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d.trim() !== key) })),
    }));

  return (
    <section className="dr-section dr-edit" aria-label="Plan">
      <h2>Plan</h2>
      <fieldset className="dr-edit-item">
        <legend>
          <span className="id">P</span> Project
        </legend>
        <div className="dr-edit-grid">
          <fieldset className="dr-edit-radios wide">
            <legend>Where the work goes</legend>
            <label>
              <input type="radio" name={modeName} checked={!existing} onChange={() => setProject({ existing: null })} /> A new project
            </label>
            <label>
              <input type="radio" name={modeName} checked={existing} onChange={() => setProject({ existing: "" })} /> An existing project
            </label>
          </fieldset>
          {existing ? (
            <Field label="Existing project" wide>
              <select value={project.existing ?? ""} onChange={(e) => setProject({ existing: e.target.value })}>
                <option value="">Choose a project</option>
                {pickerProjects(project.existing).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.id})
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Project name">
                <input value={project.name} maxLength={255} onChange={(e) => setProject({ name: e.target.value })} />
              </Field>
              <PersonSelect label="Project owner" value={project.owner} empty="Choose an owner" onChange={(owner) => setProject({ owner })} />
              <RepoChips label="Project repos" value={project.repos} onChange={(repos) => setProject({ repos })} />
              <Field label="Project description" wide>
                <textarea rows={3} value={project.desc} onChange={(e) => setProject({ desc: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      </fieldset>

      <h3>Buckets</h3>
      {buckets.map((b, i) => {
        const used = tasks.some((t) => t.bucket === b.key);
        return (
          <fieldset className="dr-edit-item" key={b.key}>
            <legend>
              <span className="id">{b.key}</span> Bucket
            </legend>
            <div className="dr-edit-grid">
              <Field label={`${b.key} name`}>
                <input value={b.name} maxLength={255} onChange={(e) => setBucket(i, { name: e.target.value })} />
              </Field>
              <PersonSelect label={`${b.key} owner`} value={b.owner} empty="Choose an owner" onChange={(owner) => setBucket(i, { owner })} />
              <RepoChips label={`${b.key} repos`} value={b.repos} onChange={(repos) => setBucket(i, { repos })} />
              <Field label={`${b.key} description`} wide>
                <textarea rows={2} value={b.desc} onChange={(e) => setBucket(i, { desc: e.target.value })} />
              </Field>
            </div>
            <div className="dr-acts">
              <button
                type="button"
                className="btn ghost sm"
                disabled={used}
                onClick={() => setPlan((p) => ({ ...p, buckets: p.buckets.filter((x) => x.key !== b.key) }))}
              >
                Remove {b.key}
              </button>
              {used && <span className="dr-task-meta">Move or remove its tasks first.</span>}
            </div>
          </fieldset>
        );
      })}
      <div className="dr-acts">
        <button type="button" className="btn ghost sm" onClick={addBucket}>
          + Add bucket
        </button>
      </div>

      <h3>Tasks</h3>
      {tasks.map((t, i) => (
        <fieldset className="dr-edit-item" key={t.key}>
          <legend>
            <span className="id">{t.key}</span> Task
          </legend>
          <div className="dr-edit-grid">
            <Field label={`${t.key} title`} wide>
              <input value={t.title} maxLength={255} onChange={(e) => setTask(i, { title: e.target.value })} />
            </Field>
            <Field label={`${t.key} bucket`}>
              <select value={t.bucket} onChange={(e) => setTask(i, { bucket: e.target.value })}>
                {!buckets.some((b) => b.key === t.bucket) && <option value={t.bucket}>{t.bucket} (no such bucket)</option>}
                {buckets.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.key} {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Choice label={`${t.key} priority`} value={t.priority} options={PRIORITIES} onChange={(priority) => setTask(i, { priority })} />
            <Choice label={`${t.key} kind`} value={t.kind} options={TASK_KINDS} onChange={(kind) => setTask(i, { kind })} />
            <PersonSelect
              label={`${t.key} accountable owner`}
              value={t.accountableOwner ?? ""}
              empty="The draft's author"
              onChange={(owner) => setTask(i, { accountableOwner: owner || null })}
            />
            <Field label={`${t.key} depends on (task keys or TASK ids, separated by commas)`}>
              <input value={t.dependsOn.join(",")} onChange={(e) => setTask(i, { dependsOn: e.target.value.split(",") })} />
            </Field>
            <RepoChips label={`${t.key} repos`} value={t.repos} onChange={(repos) => setTask(i, { repos })} />
            <Field label={`${t.key} description`} wide>
              <textarea rows={3} value={t.description} onChange={(e) => setTask(i, { description: e.target.value })} />
            </Field>
          </div>
          <div className="dr-acts">
            <button type="button" className="btn ghost sm" onClick={() => removeTask(t.key)}>
              Remove {t.key}
            </button>
          </div>
        </fieldset>
      ))}
      <div className="dr-acts">
        <button type="button" className="btn ghost sm" disabled={buckets.length === 0} onClick={addTask}>
          + Add task
        </button>
        {buckets.length === 0 && <span className="dr-task-meta">Add a bucket first.</span>}
      </div>
    </section>
  );
}

function ResearchFields({ research, setResearch }: { research: DraftResearch; setResearch: (fn: (r: DraftResearch) => DraftResearch) => void }) {
  const chosenName = useId();
  const set = (patch: Partial<DraftResearch>) => setResearch((r) => ({ ...r, ...patch }));
  const setApproach = (i: number, patch: Partial<DraftApproach>) => setResearch((r) => ({ ...r, approaches: at(r.approaches, i, patch) }));
  const setSource = (i: number, patch: Partial<DraftSource>) => setResearch((r) => ({ ...r, sources: at(r.sources, i, patch) }));
  const setFinding = (i: number, patch: Partial<DraftFinding>) => setResearch((r) => ({ ...r, findings: at(r.findings, i, patch) }));
  // A removed source leaves the findings that cited it.
  const removeSource = (ref: string) =>
    setResearch((r) => ({
      ...r,
      sources: r.sources.filter((s) => s.ref !== ref),
      findings: r.findings.map((f) => ({ ...f, sources: f.sources.filter((x) => x !== ref) })),
    }));
  const kept = [
    research.risks.length > 0 ? `${research.risks.length} risk(s)` : null,
    research.openQuestions.length > 0 ? `${research.openQuestions.length} open question(s)` : null,
    research.artifacts.length > 0 ? `${research.artifacts.length} artifact(s)` : null,
  ].filter(Boolean);

  return (
    <section className="dr-section dr-edit" aria-label="Research">
      <h2>Research</h2>
      <div className="dr-edit-grid">
        <Field label="Summary" wide>
          <textarea rows={3} value={research.summary} onChange={(e) => set({ summary: e.target.value })} />
        </Field>
        <Field label="Context" wide>
          <textarea rows={3} value={research.context} onChange={(e) => set({ context: e.target.value })} />
        </Field>
      </div>

      <h3>Approaches</h3>
      <p className="dr-task-meta">Compare at least two, and choose one.</p>
      {research.approaches.map((a, i) => (
        <fieldset className="dr-edit-item" key={i}>
          <legend>Approach {i + 1}</legend>
          <div className="dr-edit-grid">
            <Field label={`Approach ${i + 1} name`}>
              <input value={a.name} maxLength={255} onChange={(e) => setApproach(i, { name: e.target.value })} />
            </Field>
            <Choice label={`Approach ${i + 1} risk`} value={a.risk} options={LEVELS} onChange={(risk) => setApproach(i, { risk })} />
            <Choice label={`Approach ${i + 1} effort`} value={a.effort} options={EFFORTS} onChange={(effort) => setApproach(i, { effort })} />
            <label className="dr-check">
              <input
                type="radio"
                name={chosenName}
                checked={a.chosen}
                onChange={() => setResearch((r) => ({ ...r, approaches: r.approaches.map((x, j) => ({ ...x, chosen: j === i })) }))}
              />{" "}
              Chosen
            </label>
            <Field label={`Approach ${i + 1} for (one per line)`} wide>
              <textarea rows={2} value={a.pros.join("\n")} onChange={(e) => setApproach(i, { pros: e.target.value.split("\n") })} />
            </Field>
            <Field label={`Approach ${i + 1} against (one per line)`} wide>
              <textarea rows={2} value={a.cons.join("\n")} onChange={(e) => setApproach(i, { cons: e.target.value.split("\n") })} />
            </Field>
          </div>
          <div className="dr-acts">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setResearch((r) => ({ ...r, approaches: r.approaches.filter((_, j) => j !== i) }))}
            >
              Remove approach {i + 1}
            </button>
          </div>
        </fieldset>
      ))}
      <div className="dr-acts">
        <button
          type="button"
          className="btn ghost sm"
          disabled={research.approaches.length >= 10}
          onClick={() =>
            set({ approaches: [...research.approaches, { name: "", pros: [], cons: [], risk: "medium", effort: "M", chosen: research.approaches.length === 0 }] })
          }
        >
          + Add approach
        </button>
      </div>

      <div className="dr-edit-grid">
        <Field label="Recommendation" wide>
          <textarea rows={3} value={research.recommendation} onChange={(e) => set({ recommendation: e.target.value })} />
        </Field>
      </div>

      <h3>Sources</h3>
      {research.sources.map((s, i) => (
        <fieldset className="dr-edit-item" key={s.ref}>
          <legend>
            <span className="dr-ref">{s.ref}</span> Source
          </legend>
          <div className="dr-edit-grid">
            <Field label={`${s.ref} title`}>
              <input value={s.title} maxLength={500} onChange={(e) => setSource(i, { title: e.target.value })} />
            </Field>
            <Field label={`${s.ref} link or repo path`}>
              <input value={s.url} maxLength={2000} onChange={(e) => setSource(i, { url: e.target.value })} />
            </Field>
            <Choice label={`${s.ref} kind`} value={s.kind} options={["internal", "external"] as const} onChange={(kind) => setSource(i, { kind })} />
            <Field label={`${s.ref} read on`}>
              <input type="date" value={s.accessed} onChange={(e) => setSource(i, { accessed: e.target.value })} />
            </Field>
            <Field label={`${s.ref} excerpt`} wide>
              <textarea rows={2} value={s.excerpt} onChange={(e) => setSource(i, { excerpt: e.target.value })} />
            </Field>
          </div>
          <div className="dr-acts">
            <button type="button" className="btn ghost sm" onClick={() => removeSource(s.ref)}>
              Remove {s.ref}
            </button>
          </div>
        </fieldset>
      ))}
      <div className="dr-acts">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() =>
            set({
              sources: [
                ...research.sources,
                { ref: `[${nextNumber(research.sources.map((s) => s.ref))}]`, title: "", url: "", kind: "internal", excerpt: "", accessed: "" },
              ],
            })
          }
        >
          + Add source
        </button>
      </div>

      <h3>Findings</h3>
      <p className="dr-task-meta">Every finding cites at least one source.</p>
      {research.findings.map((f, i) => (
        <fieldset className="dr-edit-item" key={i}>
          <legend>Finding {i + 1}</legend>
          <div className="dr-edit-grid">
            <Field label={`Finding ${i + 1}`} wide>
              <textarea rows={2} value={f.text} onChange={(e) => setFinding(i, { text: e.target.value })} />
            </Field>
            <fieldset className="dr-edit-chips wide">
              <legend>Finding {i + 1} cites</legend>
              {research.sources.length === 0 && <span className="dr-task-meta">Add a source first.</span>}
              {research.sources.map((s) => (
                <label key={s.ref} className="dr-check">
                  <input
                    type="checkbox"
                    checked={f.sources.includes(s.ref)}
                    onChange={(e) =>
                      setFinding(i, { sources: e.target.checked ? [...f.sources, s.ref] : f.sources.filter((x) => x !== s.ref) })
                    }
                  />{" "}
                  {s.ref} {s.title}
                </label>
              ))}
            </fieldset>
          </div>
          <div className="dr-acts">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setResearch((r) => ({ ...r, findings: r.findings.filter((_, j) => j !== i) }))}
            >
              Remove finding {i + 1}
            </button>
          </div>
        </fieldset>
      ))}
      <div className="dr-acts">
        <button type="button" className="btn ghost sm" onClick={() => set({ findings: [...research.findings, { text: "", sources: [] }] })}>
          + Add finding
        </button>
      </div>
      {kept.length > 0 && (
        <p className="dr-task-meta">
          This form does not edit risks, open questions or artifacts yet. Saving keeps the draft&apos;s {kept.join(", ")} as they are.
        </p>
      )}
    </section>
  );
}

// ─── Author actions (also on the draft's record) ─────────────────────────────

/**
 * Edit, Submit for review and Withdraw, for the draft's author. Submit sends
 * the edit base the page was read with, waits for saved edits, and lists what
 * the completeness and preflight checks still need. onBusy tells the form when
 * a Submit or Withdraw is on its way, so it can lock meanwhile.
 */
export function DraftAuthorActions({
  detail,
  dirty = false,
  onEdit,
  onChanged,
  onBusy,
}: {
  detail: DraftDetail;
  dirty?: boolean;
  onEdit?: () => void;
  onChanged: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const { draft, viewer } = detail;
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues: DraftIssue[] = viewer.canSubmit ? [...detail.completeness, ...detail.preflight] : [];

  const send = async (path: string, body: unknown) => {
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      await api(`/drafts/${encodeURIComponent(draft.id)}/${path}`, { method: "POST", body: JSON.stringify(body) });
      setWithdrawing(false);
      onChanged();
    } catch (err) {
      setError(errorOf(err).message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  return (
    <div className="dr-author">
      <div className="dr-acts">
        {onEdit && viewer.canEdit && (
          <button type="button" className="btn ghost sm" onClick={onEdit}>
            Edit draft
          </button>
        )}
        {viewer.canSubmit && (
          <button
            type="button"
            className="btn acc sm"
            disabled={busy || dirty || issues.length > 0}
            onClick={() => void send("submit", { base: viewer.editBase })}
          >
            Submit for review
          </button>
        )}
        {viewer.canWithdraw && !withdrawing && (
          <button type="button" className="btn ghost sm" onClick={() => setWithdrawing(true)}>
            Withdraw…
          </button>
        )}
      </div>
      {viewer.canSubmit && dirty && <p className="dr-task-meta">Save your edits before you submit.</p>}
      {issues.length > 0 && (
        <div className="dr-banner warn" role="status">
          Before you can submit:
          <ul className="dr-bullets">
            {issues.map((issue, i) => (
              <li key={i}>
                <code>{issue.path}</code> {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {withdrawing && (
        <form
          className="dr-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send("withdraw", { reason: reason.trim() });
          }}
        >
          <label className="dr-edit-field wide">
            <span>Why withdraw {draft.id}? (10 characters or more; it stays on the draft)</span>
            <textarea rows={2} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="dr-acts">
            <button type="submit" className="btn acc sm" disabled={busy || reason.trim().length < 10}>
              Withdraw {draft.id}
            </button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setWithdrawing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <div className="dr-banner bad">{error}</div>}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export function DraftEditor({ id, nav }: { id: string | null; nav: Nav }) {
  useMcVersion();
  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<FormState | null>(() => (id ? null : blankForm()));
  const [form, setFormState] = useState<FormState | null>(() => (id ? null : blankForm()));
  const [busy, setBusy] = useState(false);
  // A Submit or Withdraw on its way: it opens the draft when it lands.
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [tick, setTick] = useState(0);
  // A load fills the form when it is the first one, a reload the person asked
  // for, or the read-back of a save made with no typing since; never over edits.
  const replaceNext = useRef(true);
  const sent = useRef<FormState | null>(null);
  // Saves started. A load that a later save overtook is dropped: it shows the
  // draft before that save, and the save reads the draft back itself.
  const saves = useRef(0);
  // The form as shown, for the load below to compare at the time it lands.
  const shown = useRef<FormState | null>(form);
  useEffect(() => {
    shown.current = form;
  }, [form]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    const startedAfter = saves.current;
    api<DraftDetail>(`/drafts/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!live || saves.current !== startedAfter) return;
        setLoadError(null);
        const fill = replaceNext.current || shown.current === null || shown.current === sent.current;
        replaceNext.current = false;
        if (fill) {
          const loaded = formFrom(data);
          setDetail(data);
          setInitial(loaded);
          setFormState(loaded);
          return;
        }
        // The person typed on after the save: keep their edits, and the base they
        // were made from. Taking the read-back's base would let their next save
        // overwrite a change another writer made meanwhile, unseen.
        setDetail((previous) => ({ ...data, viewer: { ...data.viewer, editBase: previous?.viewer.editBase ?? data.viewer.editBase } }));
      })
      .catch((err) => live && saves.current === startedAfter && setLoadError(errorOf(err).message));
    return () => {
      live = false;
    };
  }, [id, tick]);

  const dirty = form !== null && initial !== null && JSON.stringify(form) !== JSON.stringify(initial);

  // Unsaved edits: closing or reloading the tab warns, and an in-app move (a
  // link, Back, the sidebar) asks first. The form's own moves set `leaving`.
  const leaving = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    const clearGuard = setNavGuard(() => leaving.current || window.confirm("Leave without saving your edits?"));
    return () => {
      window.removeEventListener("beforeunload", warn);
      clearGuard();
    };
  }, [dirty]);

  const setForm = useCallback((fn: (f: FormState) => FormState) => {
    setSaved(false);
    setFormState((f) => (f ? fn(f) : f));
  }, []);
  const setPlan = useCallback((fn: (p: DraftPlan) => DraftPlan) => setForm((f) => ({ ...f, content: { ...f.content, plan: fn(f.content.plan) } })), [setForm]);
  const setResearch = useCallback(
    (fn: (r: DraftResearch) => DraftResearch) => setForm((f) => ({ ...f, content: { ...f.content, research: fn(f.content.research) } })),
    [setForm]
  );

  const reload = () => {
    setError(null);
    replaceNext.current = true;
    setTick((t) => t + 1);
  };

  // Unsaved edits are asked about by the navigation guard above.
  const close = () => nav("drafts", id ? { draftId: id } : {});

  const save = async () => {
    if (!form) return;
    const { body, problems } = prepare(form);
    if (problems.length > 0) {
      setError({ code: "incomplete", message: problems.join(" ") });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!id) {
        const made = await api<{ draft: { id: string } }>("/drafts", { method: "POST", body: JSON.stringify(body) });
        // The new draft opens with what was sent; the form was locked meanwhile.
        leaving.current = true;
        nav("drafts", { draftId: made.draft.id, edit: "1" });
        return;
      }
      saves.current += 1;
      sent.current = form;
      const result = await api<{ editBase: string }>(`/drafts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ base: detail!.viewer.editBase, ...body }),
      });
      // The next save names this one's base at once, before the read-back lands.
      setDetail((d) => (d ? { ...d, viewer: { ...d.viewer, editBase: result.editBase } } : d));
      // What was sent is saved, even if the read-back below fails.
      setInitial(form);
      setSaved(true);
      setTick((t) => t + 1);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const page = (children: ReactNode) => (
    <div className="mc-main dr-page" data-testid="drafts-screen">
      {/* Off while Create, Save, Submit or Withdraw runs: each opens a page of its own when it lands. */}
      <button type="button" className="btn ghost sm dr-back" disabled={busy || acting} onClick={close}>
        {id ? `← Back to ${id}` : "← All drafts"}
      </button>
      {children}
    </div>
  );

  // A failed first load has nothing to show; a failed reload keeps the form (see the Save section).
  if (loadError && (!form || (id && !detail))) return page(<div className="dr-banner bad">{loadError}</div>);
  if (!form || (id && !detail)) return page(<div className="colempty">Loading {id}…</div>);
  if (detail && !detail.viewer.canEdit) {
    return page(
      <div className="dr-banner warn">
        {detail.viewer.isAuthor
          ? `${detail.draft.id} cannot change now: it is ${detail.draft.status.replace("_", " ")}, or an Accept of it has started.`
          : `Only ${detail.draft.author} edits ${detail.draft.id}.`}
      </div>
    );
  }

  return page(
    <>
      <div className="ph">
        <div>
          <span className="kk">Draft · {id ?? "new"}</span>
          <h1>{id ? <>Edit <em>{id}</em></> : <>New <em>draft</em></>}</h1>
          <p className="sub">
            {id
              ? "Your edits stay private to the form until you save. A saved edit to a draft in review returns it to drafting; submit it again for review."
              : "Plan a project, its buckets and tasks, and the research behind them. You are the author: reviewers comment, and you accept it when it is ready."}
          </p>
        </div>
      </div>

      {/* Locked while Create, Submit or Withdraw runs: each opens the draft when it lands, so later typing would be lost. */}
      <fieldset className="dr-edit-lock" disabled={(busy && id === null) || acting}>
        <SettingsFields form={form} setForm={setForm} />
        <PlanFields plan={form.content.plan} setPlan={setPlan} />
        <ResearchFields research={form.content.research} setResearch={setResearch} />
      </fieldset>

      <section className="dr-section dr-edit-foot" aria-label="Save">
        {error && (
          <div className="dr-banner bad" role="alert">
            {error.message}{" "}
            {error.code === "draft_changed" && (
              <button type="button" className="btn ghost sm" onClick={reload}>
                Reload {id} (drops your edits)
              </button>
            )}
          </div>
        )}
        {loadError && (
          <div className="dr-banner warn" role="status">
            Could not reload {id}: {loadError}{" "}
            <button type="button" className="btn ghost sm" onClick={() => setTick((t) => t + 1)}>
              Try again
            </button>
          </div>
        )}
        {saved && !dirty && <p className="dr-task-meta">Saved.</p>}
        <div className="dr-acts">
          <button type="button" className="btn acc" disabled={busy || acting || (id !== null && !dirty)} onClick={() => void save()}>
            {busy ? "Saving…" : id ? "Save draft" : "Create draft"}
          </button>
          <button type="button" className="btn ghost" disabled={busy || acting} onClick={close}>
            {dirty ? "Cancel" : "Done"}
          </button>
        </div>
        {detail && (
          <DraftAuthorActions
            detail={detail}
            dirty={dirty}
            onChanged={() => {
              leaving.current = true;
              nav("drafts", { draftId: detail.draft.id });
            }}
            onBusy={setActing}
          />
        )}
      </section>
    </>
  );
}
