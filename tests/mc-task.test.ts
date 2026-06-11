import { describe, expect, it } from "vitest";

import {
  SP_LISTS,
  TASKS,
  type SpColumn,
  type Task,
} from "@/lib/mc-data";
import {
  SOR_FIELD_NAMES,
  deriveEvidenceProgress,
  sorDirectionForField,
} from "@/components/mc/task-detail";

const byId = (id: string): Task => TASKS.find((task) => task.id === id)!;

// Evidence-gated QA task from the go-live plan, with one item flipped done so
// both the "items remaining" and "all complete" paths stay covered.
const qaTask = (): Task => {
  const base = byId("TASK-227");
  return {
    ...base,
    evidence: {
      ...base.evidence!,
      items: base.evidence!.items.map((item, idx) => ({ ...item, done: idx === 0 })),
    },
  };
};

describe("deriveEvidenceProgress", () => {
  it("derives done/total and the gate-closed reason for incomplete evidence", () => {
    const p = deriveEvidenceProgress(qaTask());
    expect(p.done).toBe(1);
    expect(p.total).toBe(4);
    expect(p.ready).toBe(false);
    expect(p.reason).toBe("3 items remaining · gate closed");
  });

  it("reports readiness when all evidence items are complete", () => {
    const task = qaTask();
    const allDone: Task = {
      ...task,
      evidence: {
        ...task.evidence!,
        items: task.evidence!.items.map((item) => ({ ...item, done: true })),
      },
    };
    const p = deriveEvidenceProgress(allDone);
    expect(p.done).toBe(4);
    expect(p.total).toBe(4);
    expect(p.ready).toBe(true);
    expect(p.reason).toBe("All evidence complete. Ready to submit.");
  });
});

describe("sorDirectionForField", () => {
  it("uses the ToDos column map as the source of truth", () => {
    const todoColumns = SP_LISTS.find((list) => list.key === "todos")!.columns;
    for (const fieldName of SOR_FIELD_NAMES) {
      expect(sorDirectionForField(fieldName, todoColumns)).toBe("↔");
    }
  });

  it("translates two-way/push/pull into glyphs", () => {
    const customColumns: Array<Pick<SpColumn, "name" | "dir">> = [
      { name: "Status", dir: "push" },
      { name: "Assigned To", dir: "pull" },
      { name: "Due Date", dir: "two-way" },
      { name: "Priority", dir: "push" },
    ];
    expect(sorDirectionForField("Status", customColumns)).toBe("→");
    expect(sorDirectionForField("Assigned To", customColumns)).toBe("←");
    expect(sorDirectionForField("Due Date", customColumns)).toBe("↔");
    expect(sorDirectionForField("Priority", customColumns)).toBe("→");
  });
});
