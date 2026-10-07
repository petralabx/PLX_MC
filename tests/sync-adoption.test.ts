// P4: inbound adoption validation + builders + sequence helpers.
import { describe, expect, it } from "vitest";
import {
  buildAdoptedBucket,
  buildAdoptedProject,
  buildAdoptedTask,
} from "@/lib/sync/engine";
import {
  numericTaskId,
  validateInboundAdoptionRow,
} from "@/lib/sync/mapping";
import * as syncRepo from "@/lib/sync/repo";
import type { TxQuery } from "@/lib/db";

describe("validateInboundAdoptionRow", () => {
  it("accepts a valid unknown SharePoint Task", () => {
    const v = validateInboundAdoptionRow("task", {
      TaskID: "TASK-9001",
      Title: "Human-created work",
      Status: "Backlog",
      Priority: "High",
    });
    expect(v).toEqual({ ok: true, id: "TASK-9001", errors: [] });
  });

  it("will not adopt a brand-new row that arrives already Cancelled (no task to hold the reason)", () => {
    const v = validateInboundAdoptionRow("task", { TaskID: "TASK-9002", Title: "x", Status: "Cancelled", CancelReason: "Obsolete" });
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual(["cancelled_not_adoptable"]);
  });

  it("rejects invalid Task IDs and enums (audit path)", () => {
    expect(validateInboundAdoptionRow("task", { Title: "x" }).errors).toContain(
      "invalid_or_missing_task_id"
    );
    expect(
      validateInboundAdoptionRow("task", {
        TaskID: "TASK-1",
        Title: "x",
        Status: "NotARealStage",
      }).errors
    ).toContain("invalid_status");
    expect(
      validateInboundAdoptionRow("task", {
        TaskID: "not-a-task",
        Title: "x",
      }).ok
    ).toBe(false);
  });

  it("accepts valid Project and Bucket IDs; rejects garbage", () => {
    expect(
      validateInboundAdoptionRow("project", {
        ProjectID: "PRJ-HUMAN-OPS",
        Title: "Ops",
        Health: "On track",
      }).ok
    ).toBe(true);
    expect(
      validateInboundAdoptionRow("bucket", {
        InitiativeID: "BKT-HUMAN-OPS",
        Title: "Ops bucket",
        Health: "At risk",
      }).ok
    ).toBe(true);
    expect(validateInboundAdoptionRow("project", { Title: "x" }).ok).toBe(false);
    expect(
      validateInboundAdoptionRow("bucket", {
        InitiativeID: "BKT-X",
        Title: "x",
        Health: "Nope",
      }).errors
    ).toContain("invalid_health");
  });
});

describe("adoption builders never fabricate ownership", () => {
  it("builds task/bucket/project with empty owner/accountable fields", () => {
    const t = buildAdoptedTask("TASK-42", { Title: "T", Status: "Backlog" });
    expect(t.accountableOwner).toBeNull();
    expect(t.reporter).toBe("");
    expect(t.title).toBe("T");

    const b = buildAdoptedBucket("BKT-X", { Title: "Bucket", Health: "On track" });
    expect(b.owner).toBe("");
    expect(b.name).toBe("Bucket");

    const p = buildAdoptedProject("PRJ-X", { Title: "Project", Health: "At risk" });
    expect(p.owner).toBe("");
    expect(p.health).toBe("risk");
  });
});

describe("numericTaskId sequence input", () => {
  it("parses TASK-* numerics and rejects non-numeric", () => {
    expect(numericTaskId("TASK-9001")).toBe(9001);
    expect(numericTaskId("TASK-1")).toBe(1);
    expect(numericTaskId("BKT-X")).toBeNull();
  });
});

describe("atomic adopted Task persistence", () => {
  it("uses one injected transaction for insert/bind and sequence reconciliation", async () => {
    type InsertAdoptedTask = (
      task: ReturnType<typeof buildAdoptedTask>,
      spItemId: string,
      runTransaction: <T>(fn: (tx: TxQuery) => Promise<T>) => Promise<T>
    ) => Promise<boolean>;
    const insertAdoptedTask = (
      syncRepo as typeof syncRepo & { insertAdoptedTask?: InsertAdoptedTask }
    ).insertAdoptedTask;
    expect(typeof insertAdoptedTask).toBe("function");

    const task = buildAdoptedTask("TASK-750", {
      Title: "Adopt atomically",
      Status: "Backlog",
    });
    const sql: string[] = [];
    let transactionCount = 0;
    const q: TxQuery = async (text) => {
      sql.push(text);
      if (/INSERT INTO entities/.test(text)) return [{ id: task.id }] as never;
      if (/setval/.test(text)) return [{ setval: "750" }] as never;
      return [] as never;
    };
    const runTransaction = async <T>(fn: (tx: TxQuery) => Promise<T>): Promise<T> => {
      transactionCount += 1;
      return fn(q);
    };

    await expect(
      insertAdoptedTask!(task, "sp-750", runTransaction)
    ).resolves.toBe(true);
    expect(transactionCount).toBe(1);
    expect(sql.some((text) => /INSERT INTO entities/.test(text))).toBe(true);
    expect(sql.some((text) => /sp_item_id/.test(text))).toBe(true);
    expect(sql.some((text) => /mc_task_id_seq/.test(text) && /GREATEST/.test(text))).toBe(true);
  });

  it("rolls back the adoption contract when sequence reconciliation fails", async () => {
    const task = buildAdoptedTask("TASK-751", {
      Title: "Rollback me",
      Status: "Backlog",
    });
    const staged: string[] = [];
    const committed: string[] = [];
    const runTransaction = async <T>(fn: (tx: TxQuery) => Promise<T>): Promise<T> => {
      const q: TxQuery = async (text) => {
        if (/INSERT INTO entities/.test(text)) {
          staged.push(task.id);
          return [{ id: task.id }] as never;
        }
        if (/setval/.test(text)) throw new Error("sequence failure");
        return [] as never;
      };
      try {
        const result = await fn(q);
        committed.push(...staged);
        return result;
      } catch (err) {
        staged.length = 0;
        throw err;
      }
    };

    await expect(
      syncRepo.insertAdoptedTask(task, "sp-751", runTransaction)
    ).rejects.toThrow("sequence failure");
    expect(committed).toEqual([]);
    expect(staged).toEqual([]);
  });

  it("reconciles an imported ID before an overlapping allocator can issue the next ID", async () => {
    const task = buildAdoptedTask("TASK-900", {
      Title: "Race-safe import",
      Status: "Backlog",
    });
    let sequence = 899;
    const issued: number[] = [];
    const q: TxQuery = async (text, params = []) => {
      if (/INSERT INTO entities/.test(text)) return [{ id: task.id }] as never;
      if (/setval/.test(text)) {
        sequence = Math.max(sequence, Number(params[0]));
        return [{ setval: String(sequence) }] as never;
      }
      return [] as never;
    };
    const runTransaction = async <T>(fn: (tx: TxQuery) => Promise<T>): Promise<T> => fn(q);

    await syncRepo.insertAdoptedTask(task, "sp-900", runTransaction);
    issued.push(++sequence);
    expect(issued).toEqual([901]);
  });
});
