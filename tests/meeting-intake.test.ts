// Invariant tests for the meeting → Mission Control bridge (EN-004 / WS-4).
// These protect behavior, not fixture shape: adapter parsing against FIXTURE
// aiInsights + .vtt payloads (no live Graph/Copilot/Azure), owner resolution
// from a display name, promote → a GOVERNED task with the right owner + repo
// linkage, and the disabled-by-default gating (flag off / not opted in disables
// capture and promotion). The transcript extractor is injected as a mock — the
// in-tenant Azure path is never hit here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUCKET_IDX, type Human } from "@/lib/mc-data";
import { __setStateLoaderForTests, allTasks, resetStore, taskById, type ServerSnapshot } from "@/lib/mc-data/store";
import {
  draftProposedTask,
  meetingIntakeEnabled,
  parseAiInsights,
  parseVtt,
  resolveOwnerByDisplayName,
  setMeetingIntakeEnabled,
  transcriptToActionItems,
  tripMeetingIntakeKillSwitch,
  type ActionItemExtractor,
  type AiInsightsPayload,
  type MeetingRef,
} from "@/lib/meeting-intake";
import {
  captureFromAiInsights,
  captureFromTranscript,
  dismissProposedTask,
  optInMeeting,
  pendingProposedTasks,
  promoteProposedTask,
  proposedTasks,
  resetMeetingIntake,
} from "@/lib/meeting-intake/store";

const MEETING: MeetingRef = { meetingId: "mtg-1", title: "Go-live standup" };

const AI_INSIGHTS: AiInsightsPayload = {
  id: "insight-1",
  actionItems: [
    {
      title: "Update the API contract",
      text: "Greg to update the Swagger contract by Friday.",
      ownerDisplayName: "Greg Mitchell",
    },
    { title: "", text: "" }, // no usable title — dropped
    { title: "Schedule QMS review", ownerDisplayName: "Nobody Here" },
  ],
};

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Greg Mitchell>We need to update the API contract by Friday.</v>

00:00:06.000 --> 00:00:09.500
<v Vince Alton>I'll own the QMS review.</v>
`;

// A deterministic stand-in for the in-tenant Azure OpenAI extractor.
const mockExtractor: ActionItemExtractor = async (cues) => [
  {
    title: "Update the API contract by Friday",
    ownerDisplayName: "Greg Mitchell",
    snippet: cues[0].text,
    timestamp: cues[0].start,
  },
];

beforeEach(() => {
  resetStore();
  resetMeetingIntake();
});

describe("Tier B — aiInsights adapter", () => {
  it("parses action items and drops ones without a usable title", () => {
    const items = parseAiInsights(AI_INSIGHTS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Update the API contract",
      ownerDisplayName: "Greg Mitchell",
      source: "aiInsights",
    });
    expect(items[1].title).toBe("Schedule QMS review");
  });

  it("returns [] for an empty payload", () => {
    expect(parseAiInsights({})).toEqual([]);
  });
});

describe("Tier A — VTT parsing + extractor seam", () => {
  it("parses WEBVTT cues with speaker voice spans", () => {
    const cues = parseVtt(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      start: "00:00:01.000",
      speaker: "Greg Mitchell",
      text: "We need to update the API contract by Friday.",
    });
  });

  it("runs the transcript through the injected extractor (no live Azure)", async () => {
    const items = await transcriptToActionItems(VTT, MEETING, mockExtractor);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Update the API contract by Friday",
      source: "transcript",
      snippet: "We need to update the API contract by Friday.",
      timestamp: "00:00:01.000",
    });
  });
});

describe("owner resolution from display name", () => {
  const fakeDir: Human[] = [
    { id: "alex1", kind: "human", name: "Alex Stone", init: "AS", role: "X", online: false },
    { id: "alex2", kind: "human", name: "Alex Rivera", init: "AR", role: "X", online: false },
    { id: "sam", kind: "human", name: "Sam Doe", init: "SD", role: "X", online: false },
  ];

  it("resolves an exact full-name match", () => {
    expect(resolveOwnerByDisplayName("Sam Doe", fakeDir)).toBe("sam");
  });

  it("resolves a unique first-name match", () => {
    expect(resolveOwnerByDisplayName("Sam", fakeDir)).toBe("sam");
  });

  it("returns null for an ambiguous first name (never guesses)", () => {
    expect(resolveOwnerByDisplayName("Alex", fakeDir)).toBeNull();
  });

  it("returns null for an unknown or empty name", () => {
    expect(resolveOwnerByDisplayName("Nobody Here", fakeDir)).toBeNull();
    expect(resolveOwnerByDisplayName(undefined, fakeDir)).toBeNull();
  });

  it("drafts a proposed task with the resolved owner and evidence", () => {
    const draft = draftProposedTask(
      { title: "Do the thing", ownerDisplayName: "Sam Doe", snippet: "snip", timestamp: "00:01", source: "transcript" },
      MEETING,
      { humans: fakeDir, candidateBucket: "BKT-WMS" }
    );
    expect(draft.ownerId).toBe("sam");
    expect(draft.candidateBucket).toBe("BKT-WMS");
    expect(draft.evidence).toMatchObject({ source: "transcript", snippet: "snip", timestamp: "00:01" });
  });
});

describe("gating — disabled by default", () => {
  it("ships off by default", () => {
    expect(meetingIntakeEnabled()).toBe(false);
  });

  it("captures nothing when the feature is off (even if opted in)", () => {
    optInMeeting(MEETING.meetingId);
    const made = captureFromAiInsights(MEETING, AI_INSIGHTS);
    expect(made).toEqual([]);
    expect(proposedTasks()).toEqual([]);
  });

  it("captures nothing when on but the meeting is not opted in", () => {
    setMeetingIntakeEnabled(true);
    const made = captureFromAiInsights(MEETING, AI_INSIGHTS);
    expect(made).toEqual([]);
  });

  it("the kill switch forces the feature off regardless of the flag", () => {
    setMeetingIntakeEnabled(true);
    tripMeetingIntakeKillSwitch();
    expect(meetingIntakeEnabled()).toBe(false);
    optInMeeting(MEETING.meetingId);
    expect(captureFromAiInsights(MEETING, AI_INSIGHTS)).toEqual([]);
  });
});

describe("capture → triage → promote (governed)", () => {
  beforeEach(() => {
    setMeetingIntakeEnabled(true);
    optInMeeting(MEETING.meetingId);
  });

  it("Tier B capture queues proposed tasks with resolved owners", () => {
    const made = captureFromAiInsights(MEETING, AI_INSIGHTS);
    expect(made).toHaveLength(2);
    expect(pendingProposedTasks()).toHaveLength(2);
    expect(made[0].ownerId).toBe("greg"); // "Greg Mitchell" → directory
    expect(made[1].ownerId).toBeNull(); // "Nobody Here" → unresolved
    expect(made[0].status).toBe("proposed");
  });

  it("Tier A capture queues a transcript-sourced proposal (mock extractor)", async () => {
    const made = await captureFromTranscript(MEETING, VTT, mockExtractor);
    expect(made).toHaveLength(1);
    expect(made[0].evidence.source).toBe("transcript");
    expect(made[0].evidence.snippet).toContain("API contract");
  });

  it("promotes a proposal into a GOVERNED task via addTask with owner + repo linkage", () => {
    const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
    const task = promoteProposedTask(proposal.id, { bucket: "BKT-WMS" });
    expect(task).not.toBeNull();

    const created = taskById(task!.id)!;
    expect(created.accountableOwner).toBe("greg"); // human accountable owner
    expect(created.assignee).toBe("greg");
    expect(created.bucket).toBe("BKT-WMS");
    // Repo linkage: inherits the initiative's allow-listed repos (WS-2).
    expect(created.repos).toEqual(BUCKET_IDX["BKT-WMS"].repos);
    // Meeting source kept as a traceability artifact.
    expect(created.description).toContain("Captured from meeting");
    expect(created.labels).toContain("from-meeting");

    // The proposal is marked promoted and leaves the pending queue.
    expect(proposedTasks().find((p) => p.id === proposal.id)?.status).toBe("promoted");
    expect(pendingProposedTasks()).toHaveLength(1);
  });

  // TASK-4294: a create the server refuses is rolled back, and the item it
  // came from goes back to the triage queue instead of pointing at nothing.
  it("puts a proposal back in the queue when the server refuses its task", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "forbidden", message: "Refused." } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    ));
    try {
      const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
      const task = promoteProposedTask(proposal.id, { bucket: "BKT-WMS" });
      expect(proposedTasks().find((p) => p.id === proposal.id)?.status).toBe("promoted");
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      const back = proposedTasks().find((p) => p.id === proposal.id)!;
      expect(back.status).toBe("proposed");
      expect(back.promotedTaskId).toBeUndefined();
      expect(pendingProposedTasks().map((p) => p.id)).toContain(proposal.id);
      expect(taskById(task!.id)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // TASK-4294: with no clear answer, the reload decides. The item goes back to
  // the queue if the task did not land, and links the server's task if it did.
  describe("a promote whose create gets no clear answer", () => {
    const flush = async () => {
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const reloadWith = (tasks: () => ReturnType<typeof allTasks>) =>
      __setStateLoaderForTests(async (): Promise<ServerSnapshot> => ({
        tasks: structuredClone(tasks()), risks: [], files: [], conflicts: [], errors: [], audit: [], counts: {}, lastSweep: "now",
      }));
    beforeEach(() => {
      vi.stubGlobal("window", {});
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("puts the item back when the reload has no such task", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new TypeError("fetch failed");
      }));
      const before = structuredClone(allTasks());
      let lookalike = before[0];
      // A task with the same title and text that did not come from a meeting.
      reloadWith(() => [...before, lookalike]);
      const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
      const task = promoteProposedTask(proposal.id, { bucket: "BKT-WMS" })!;
      lookalike = { ...structuredClone(task), id: "TASK-9998", labels: [] };
      await flush();
      const back = proposedTasks().find((p) => p.id === proposal.id)!;
      expect(back.status).toBe("proposed");
      expect(back.promotedTaskId).toBeUndefined();
    });

    it("puts the item back when the reload fails too", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new TypeError("fetch failed");
      }));
      __setStateLoaderForTests(async () => {
        throw new TypeError("fetch failed");
      });
      const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
      promoteProposedTask(proposal.id, { bucket: "BKT-WMS" });
      await flush();
      const back = proposedTasks().find((p) => p.id === proposal.id)!;
      expect(back.status).toBe("proposed");
      expect(back.promotedTaskId).toBeUndefined();
    });

    it("links the server's task when the reload shows it landed", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Gateway timeout</html>", { status: 504 })));
      let optimisticId = "";
      reloadWith(() => allTasks().map((t) => (t.id === optimisticId ? { ...t, id: "TASK-9999" } : t)));
      const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
      optimisticId = promoteProposedTask(proposal.id, { bucket: "BKT-WMS" })!.id;
      await flush();
      const linked = proposedTasks().find((p) => p.id === proposal.id)!;
      expect(linked.status).toBe("promoted");
      expect(linked.promotedTaskId).toBe("TASK-9999");
      expect(taskById("TASK-9999")?.labels).toContain("from-meeting");
    });

    it("follows the server's id when the create is accepted under another id", async () => {
      vi.stubGlobal("fetch", vi.fn(async () =>
        new Response(JSON.stringify({ data: { id: "TASK-9999", title: "Update the API contract" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
      ));
      const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
      promoteProposedTask(proposal.id, { bucket: "BKT-WMS" });
      await flush();
      expect(proposedTasks().find((p) => p.id === proposal.id)?.promotedTaskId).toBe("TASK-9999");
    });
  });

  it("clamps promoted repos to the allow-list", () => {
    const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
    const task = promoteProposedTask(proposal.id, { bucket: "BKT-WMS", repos: ["portal-web", "ghost-repo"] });
    expect(task!.repos).toEqual(["portal-web"]);
  });

  it("refuses to promote without an initiative", () => {
    const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS); // no candidate bucket
    expect(promoteProposedTask(proposal.id)).toBeNull();
    expect(proposedTasks().find((p) => p.id === proposal.id)?.status).toBe("proposed");
  });

  it("dismisses a proposal", () => {
    const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
    expect(dismissProposedTask(proposal.id)).toBe(true);
    expect(proposedTasks().find((p) => p.id === proposal.id)?.status).toBe("dismissed");
    expect(pendingProposedTasks()).toHaveLength(1);
  });

  it("disables promotion when the flag is turned off", () => {
    const [proposal] = captureFromAiInsights(MEETING, AI_INSIGHTS);
    setMeetingIntakeEnabled(false);
    expect(promoteProposedTask(proposal.id, { bucket: "BKT-WMS" })).toBeNull();
  });
});
