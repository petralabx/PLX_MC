// Help screen copy (Wave 6 — colleague UX). Plain data, no React, so the
// vocabulary is unit-tested (tests/mc-help.test.ts). "Initiative" is the only
// user-facing name for what the code and API call a bucket (ids stay BKT-*).
// Stage names and gates are read from STAGES so the glossary cannot drift from
// the board.
import { STAGES } from "@/lib/mc-data";

export interface GlossaryEntry {
  term: string;
  definition: string;
  /** An ordered list shown under the definition (the stages, for Stage). */
  list?: string[];
}

export const HOW_IT_WORKS: string[] = [
  "Work is organised as projects, initiatives inside them, and tasks inside those. Everything resolves to a task.",
  "Each task moves through nine stages, from Backlog to Verified. Gates on the way (a PRD, then evidence) keep “done” honest.",
  "People and AI agents both do the work, but a named human is always accountable for every task.",
  "Every change mirrors to SharePoint, the system of record. Anything that fails to sync shows under SharePoint sync issues.",
  "Home shows what needs you today: approvals, routing decisions, overdue work — one action per row.",
];

const gatedStages = STAGES.filter((s) => s.gate)
  .map((s) => `${s.gate} gate on ${s.name}`)
  .join(", ");

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: "Task",
    definition:
      "One piece of work with one accountable human, shown with an id like TASK-221. Board, List, Timeline and My tasks are all views of the same tasks.",
  },
  {
    term: "Initiative",
    definition:
      "A group of related tasks working toward one outcome, with its own owner, target date, health and PRD. Initiative ids look like BKT-WMS.",
  },
  {
    term: "Project",
    definition:
      "An optional umbrella above initiatives — for example PLX Portal Go-Live groups every go-live initiative so you can see them rolled up together.",
  },
  {
    term: "Stage",
    definition: `Where a task is in its lifecycle. There are nine, in order. The board marks each quality checkpoint: ${gatedStages}.`,
    list: STAGES.map((s) => s.name),
  },
  {
    term: "PRD",
    definition:
      "Product requirements document: the problem, testable requirements with acceptance criteria, non-goals and a rollback plan. Every initiative carries one.",
  },
  {
    term: "Evidence",
    definition:
      "Proof that a task works — test results, screenshots, QA runs, a rollback note. A task can't be marked Merged or Verified until its evidence is complete.",
  },
  {
    term: "Accountable owner",
    definition:
      "The human who owns a task's outcome. People or agents can do the work, but a task can't move past Planned without an accountable owner.",
  },
  {
    term: "Checkout / MC-Checkout stamp",
    definition:
      "Before an agent or engineer changes code for a task, they check it out in Mission Control. The checkout gives a stamp line that goes in the pull request, so the change is tied to its task.",
  },
  {
    term: "Compliance gate",
    definition:
      "An automatic check on pull requests in tracked repos. It verifies the checkout stamp, the linked task and its evidence before the change can merge.",
  },
  {
    term: "Routing",
    definition:
      "Mission Control suggests which task a change, like a pull request, belongs to. When a person needs to decide, the proposal waits in the Routing inbox.",
  },
];
