// Wave 2 — UI trust: the Approvals inbox showed an auth error AND "No pending
// approvals" at once (a failed load set rows to []). It now has exactly one of
// four states — loading / error-with-retry / empty / list. No DOM environment
// (vitest runs in Node), so states are rendered with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ApprovalsInboxView,
  ApprovalsStatus,
  approvalsView,
  type ApprovalsLoad,
} from "@/components/mc/approvals-inbox";

const EMPTY_COPY = "No pending approvals";
const ROW = {
  taskId: "TASK-221",
  taskTitle: "WMS integration",
  stage: "progress",
  gate: {
    id: "gate-1",
    reason: "Needs a prod credential",
    requestedBy: "vibes",
    requestedAt: "2026-09-25T12:00:00Z",
    status: "pending",
  },
} as const;

const status = (load: ApprovalsLoad) =>
  renderToStaticMarkup(createElement(ApprovalsStatus, { load, onRetry: () => {} }));

describe("approvalsView — exactly one state", () => {
  it("maps each load outcome to a single view", () => {
    expect(approvalsView({ status: "loading" })).toBe("loading");
    expect(approvalsView({ status: "error", message: "Unauthorized" })).toBe("error");
    expect(approvalsView({ status: "ready", rows: [] })).toBe("empty");
    expect(approvalsView({ status: "ready", rows: [ROW] as never })).toBe("list");
  });
});

describe("ApprovalsStatus rendering", () => {
  it("a failed load shows the error with Retry — and never the empty state", () => {
    const html = status({ status: "error", message: "No signed-in session found." });
    expect(html).toContain("No signed-in session found.");
    expect(html).toContain("Retry");
    expect(html).not.toContain(EMPTY_COPY);
    expect(html).not.toContain("Loading");
  });

  it("an empty queue shows only the empty state", () => {
    const html = status({ status: "ready", rows: [] });
    expect(html).toContain(EMPTY_COPY);
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Loading");
  });

  it("loading shows only the loading state", () => {
    const html = status({ status: "loading" });
    expect(html).toContain("Loading");
    expect(html).not.toContain(EMPTY_COPY);
    expect(html).not.toContain("Retry");
  });

  it("renders nothing of its own when there are rows (the list owns the view)", () => {
    expect(status({ status: "ready", rows: [ROW] as never })).toBe("");
  });

  it("the screen's first paint is the loading state alone", () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsInboxView, { route: { screen: "approvals" }, nav: () => {} })
    );
    expect(html).toContain("Loading");
    expect(html).not.toContain(EMPTY_COPY);
    expect(html).not.toContain("ap-error");
  });
});
