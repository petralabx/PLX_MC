import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Bucket, Project } from "@/lib/mc-data/types";
const h = vi.hoisted(() => ({ buckets: [] as Bucket[], projects: [] as Project[], stateCalls: 0 }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => actual.useState(h.stateCalls++ === 0 ? "Ready to create" : initial) };
});
vi.mock("@/lib/mc-data/hooks", () => ({ useMcVersion: () => 0 }));
vi.mock("@/lib/mc-data/store", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  allBuckets: () => h.buckets,
  bucketById: (id: string) => h.buckets.find((b) => b.id === id),
  projectById: (id: string) => h.projects.find((p) => p.id === id),
}));
import { NewTaskModal } from "@/components/mc/new-task-modal";
const render = (bucketId?: string) => {
  h.stateCalls = 0;
  return renderToStaticMarkup(createElement(NewTaskModal, { ctx: { bucketId }, onClose: () => {}, nav: () => {} }));
};
beforeEach(() => {
  h.projects = [{ id: "PRJ-OLD", archivedAt: "retired" } as Project];
  h.buckets = [
    { id: "BKT-OLD", name: "Archived bucket", archivedAt: "retired" },
    { id: "BKT-PARENT", name: "Archived parent", project: "PRJ-OLD" },
    { id: "BKT-LIVE", name: "Live" },
  ] as Bucket[];
});
it("filters archived buckets and parents and defaults to the first eligible bucket even for archived context", () => {
  for (const context of [undefined, "BKT-OLD", "BKT-PARENT"]) {
    const html = render(context);
    expect(html).not.toContain('value="BKT-OLD"');
    expect(html).not.toContain('value="BKT-PARENT"');
    expect(html).toContain('<option value="BKT-LIVE" selected="">');
    expect(html).toMatch(/<button[^>]*class="btn acc">Create task/);
  }
});
it("disables the picker and creation when no eligible bucket exists", () => {
  h.buckets.pop();
  const html = render();
  expect(html).toContain('<select disabled="">');
  expect(html).toContain("No eligible initiatives");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create task/);
});
