"use client";

import { useState, type CSSProperties } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  FileText,
  Flag,
  Folder,
  ListChecks,
  MapIcon,
  Pencil,
  TriangleAlert,
} from "lucide-react";

import { ACTORS, MILESTONES, PROJECTS } from "@/lib/mc-data";
import { SHAREPOINT_REGISTERS, docLinkFromPrd, docLinkKind, type SharePointRegisterKey } from "@/lib/mc-data/doc-links";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allRisks, allTasks, bucketsForProject, projectById, pushNotice, updateProject } from "@/lib/mc-data/store";

import { Avatar, HealthPill, SyncTick } from "./atoms";
import { OverviewStrip, StripFact, StripHealthSelect } from "./overview-strip";
import { PeoplePicker } from "./people-picker";
import { ProjectOverview, SPEC_ICON } from "./project-overview";
import { needsHuman, parseMcDate, projectProgress, rollupForProject, shortDate } from "./project-overview.helpers";
import type { ScreenProps } from "./route";

const FALLBACK_PROJECT = PROJECTS[0];

// The two project lenses: Overview (initiative sections + task tables — the
// default whole-project read) and Initiatives (the P1 card grid).
type ProjectLens = "overview" | "initiatives";

const REGISTER_ICON: Record<SharePointRegisterKey, typeof Folder> = {
  plan: ListChecks,
  roadmap: MapIcon,
  milestones: Flag,
  risks: TriangleAlert,
  documents: Folder,
};

export function ProjectDetail({ route, nav }: ScreenProps) {
  useMcVersion();

  const project = projectById(route.projectId ?? FALLBACK_PROJECT.id) ?? FALLBACK_PROJECT;
  const buckets = bucketsForProject(project.id);
  const tasks = allTasks().filter((t) => buckets.some((b) => b.id === t.bucket));

  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [lens, setLens] = useState<ProjectLens>("overview");

  const rollups = rollupForProject(buckets, tasks);
  const progress = projectProgress(tasks);
  const projectSpec = docLinkFromPrd(project.prd);
  const bucketIds = new Set(buckets.map((b) => b.id));
  const milestoneCount = MILESTONES.filter((m) => bucketIds.has(m.bucket)).length;
  const openRisks = allRisks().filter((r) => bucketIds.has(r.bucket) && r.status !== "closed").length;
  const atRisk = buckets.filter((b) => b.health === "risk").length;
  const offTrack = buckets.filter((b) => b.health === "off").length;
  const started = parseMcDate(project.started, new Date().getFullYear());
  const registerMeta: Record<SharePointRegisterKey, string> = {
    plan: "MS List",
    roadmap: "MS List",
    milestones: `MS List · ${milestoneCount} milestones`,
    risks: `MS List · ${openRisks} open`,
    documents: "Library",
  };

  // All edits route through updateProject (store) → PATCH /api/projects/{id}:
  // optimistic local apply, reconcile to server truth on success, rollback +
  // non-silent notice on failure — the same contract as updateBucket.
  const commitTarget = (raw: string) => {
    const target = raw.trim() || "—";
    if (target !== project.target) updateProject(project.id, { target });
  };

  return (
    <div className="mc-main pv-page" data-testid="project-screen">
      <div className="ph">
        <div>
          <button type="button" className="back" onClick={() => nav("home")}>
            ← Back
          </button>
          <span className="kk bucket-kicker">Project · {project.id}</span>
          <h1>{project.name}</h1>
          {editingDesc ? (
            <div className="desc-edit ph-desc-edit">
              <textarea
                className="desc-input"
                value={descDraft}
                onChange={(event) => setDescDraft(event.target.value)}
                placeholder="What is this project about?"
                aria-label="Edit project description"
                rows={3}
                autoFocus
              />
              <div className="desc-edit-acts">
                <button type="button" className="btn ghost sm" onClick={() => setEditingDesc(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    updateProject(project.id, { desc: descDraft.trim() });
                    setEditingDesc(false);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className="sub">
              {project.desc || "No description yet."}{" "}
              <button
                type="button"
                className="tl-link"
                onClick={() => {
                  setDescDraft(project.desc ?? "");
                  setEditingDesc(true);
                }}
              >
                {project.desc ? "Edit" : "Add description"}
              </button>
            </p>
          )}
        </div>
        <div className="r">
          <HealthPill h={project.health} />
          <SyncTick sync={project.sync} />
          <nav className="pv-seg" aria-label="Project lens">
            <button
              type="button"
              className={lens === "overview" ? "on" : ""}
              onClick={() => setLens("overview")}
            >
              Overview
            </button>
            <button
              type="button"
              className={lens === "initiatives" ? "on" : ""}
              onClick={() => setLens("initiatives")}
            >
              Initiatives
            </button>
          </nav>
        </div>
      </div>

      <div className="bk">
        <OverviewStrip
          progress={progress}
          started={project.started}
          target={project.target}
          subline={
            <>
              {buckets.length} initiatives · {progress.total} tasks · {progress.doing} in flight ·{" "}
              <span className={atRisk > 0 ? "warn" : ""}>{atRisk} at risk</span>
              {offTrack > 0 && (
                <>
                  {" "}
                  · <span className="hot">{offTrack} off track</span>
                </>
              )}
            </>
          }
        >
          {/* All edits route through updateProject (see commitTarget above). */}
          <StripFact label="Health">
            <StripHealthSelect
              value={project.health}
              label="Set project health"
              onChange={(health) => updateProject(project.id, { health })}
            />
          </StripFact>
          {/* Accountable owner — always human; same field-button + PeoplePicker
              pattern as the task facts rail / New Initiative modal. */}
          <StripFact label="Accountable owner">
            <span className="pv-owner">
              <button
                type="button"
                className="ntm-field-btn"
                onClick={() => setOwnerPickerOpen((open) => !open)}
              >
                <span className="who fact-owner">
                  <Avatar id={project.owner} size="sm" />
                  <span className="nm">{ACTORS[project.owner]?.name ?? project.owner}</span>
                </span>
                <ChevronDown size={11} className="caret" aria-hidden="true" />
              </button>
              {ownerPickerOpen && (
                <PeoplePicker
                  allowAgents={false}
                  current={project.owner}
                  onPick={(actorId) => {
                    // A project always carries a human accountable owner —
                    // an "Unassign" click is blocked with a visible notice.
                    if (actorId) {
                      updateProject(project.id, { owner: actorId });
                      return;
                    }
                    pushNotice("Projects require a human accountable owner.");
                  }}
                  onClose={() => setOwnerPickerOpen(false)}
                  style={{ top: "calc(100% + 6px)", left: 0 }}
                />
              )}
            </span>
          </StripFact>
          <StripFact label="Started">{started ? shortDate(started) : project.started}</StripFact>
          {/* Target — inline text edit, commit on blur/Enter (the sub-task due
              pattern) in the underline input skin (.le-input). Keyed on the
              store value so a rollback re-renders the restored target. */}
          <StripFact label="Target">
            <span className="pv-target">
              <input
                key={`${project.id}:${project.target}`}
                className="le-input"
                defaultValue={project.target}
                onBlur={(event) => commitTarget(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                placeholder="e.g. Aug 01"
                aria-label="Set target"
              />
              <Pencil size={11} aria-hidden="true" />
            </span>
          </StripFact>
        </OverviewStrip>

        {/* pv-wide: both lenses are single-column. .bkbody's default 1.6fr/1fr
            split is for bucket detail's two-column body. */}
        <div className="bkbody pv-wide">
          <div className="c">
            <div className="blk pv-res" data-testid="project-resources">
              <div className="bh">
                <span className="kk">/ Project resources</span>
                <span className="kk">
                  SharePoint · <SyncTick sync={project.sync} />
                </span>
              </div>
              <div className="pv-tiles">
                {SHAREPOINT_REGISTERS.map((register) => {
                  const Icon = REGISTER_ICON[register.key];
                  const inner = (
                    <>
                      <Icon size={15} className="ic" aria-hidden="true" />
                      <span className="tx">
                        <span className="t">{register.label}</span>
                        <span className="m">{registerMeta[register.key]}</span>
                      </span>
                      <ArrowUpRight size={12} className="ext" aria-hidden="true" />
                    </>
                  );
                  // Same behaviour as the initiative page's register links:
                  // documents opens Files; the MS List links are not provisioned yet.
                  return register.key === "documents" ? (
                    <button type="button" className="pv-tile" key={register.key} onClick={() => nav("files")}>
                      {inner}
                    </button>
                  ) : (
                    <button type="button" className="pv-tile" key={register.key} title="coming soon">
                      {inner}
                    </button>
                  );
                })}
                {projectSpec && (
                  <a
                    className="pv-tile"
                    href={projectSpec.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Project spec · ${projectSpec.label}`}
                  >
                    <FileText size={15} className="ic" aria-hidden="true" />
                    <span className="tx">
                      <span className="t">{projectSpec.label}</span>
                      <span className="m">Project spec</span>
                    </span>
                    <ArrowUpRight size={12} className="ext" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
            <div className="blk">
              {lens === "overview" ? (
                <ProjectOverview projectId={project.id} rollups={rollups} nav={nav} />
              ) : (
                <>
                  <div className="bh">
                    <span className="kk">
                      / Initiatives · <b>{buckets.length}</b>
                    </span>
                  </div>
                  {buckets.length === 0 ? (
                    <p className="sub">No initiatives under this project yet.</p>
                  ) : (
                    <div className="init-grid">
                      {rollups.map(({ bucket, tasks: bucketTasks, closedTasks, remaining, pct }) => {
                        const barStyle = { "--pct": `${pct}%` } as CSSProperties;
                        const spec = docLinkFromPrd(bucket.prd);
                        const SpecIcon = spec ? SPEC_ICON[docLinkKind(spec)] : FileText;
                        return (
                          <button
                            type="button"
                            key={bucket.id}
                            className={`init-card ${bucket.health}`}
                            onClick={() => nav("bucket", { bucketId: bucket.id, projectId: project.id })}
                          >
                            <span className="ih">
                              <span className="id">{bucket.id}</span>
                              <HealthPill h={bucket.health} />
                            </span>
                            <span className="nm">{bucket.name}</span>
                            <span className="meta">
                              <span>
                                {remaining} open · {bucketTasks.filter(needsHuman).length} need a human
                              </span>
                              {spec && (
                                <>
                                  <span className="sep" aria-hidden="true">
                                    |
                                  </span>
                                  <span className="spec">
                                    <SpecIcon size={11} aria-hidden="true" />
                                    <span className="lb">{spec.label}</span>
                                  </span>
                                </>
                              )}
                            </span>
                            <span className="prog">
                              <span className="bar" style={barStyle}>
                                <span className="fill" />
                              </span>
                              <span className="ct">
                                {bucketTasks.length === 0
                                  ? "No tasks yet"
                                  : `${closedTasks} / ${bucketTasks.length} closed`}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
