import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));

import BucketDeepLink from "@/app/buckets/[id]/page";
import ProjectDeepLink from "@/app/projects/[id]/page";
import { urlToRoute } from "@/components/mc/route";
import { bucketLink, projectLink } from "@/lib/mcp/envelope";

async function projectTarget(id: string): Promise<string> {
  await ProjectDeepLink({ params: Promise.resolve({ id }) });
  expect(m.redirect).toHaveBeenCalledTimes(1);
  return m.redirect.mock.calls[0][0];
}

async function bucketTarget(id: string): Promise<string> {
  await BucketDeepLink({ params: Promise.resolve({ id }) });
  expect(m.redirect).toHaveBeenCalledTimes(1);
  return m.redirect.mock.calls[0][0];
}

describe("/projects/[id] deep link (TASK-3442)", () => {
  beforeEach(() => m.redirect.mockReset());

  it("redirects a PRJ id to the project screen the shell reads", async () => {
    const url = await projectTarget("PRJ-FLEET-COMPLIANCE");
    expect(url).toBe("/?screen=project&projectId=PRJ-FLEET-COMPLIANCE");
    expect(urlToRoute(url)).toEqual({ screen: "project", projectId: "PRJ-FLEET-COMPLIANCE" });
  });

  it("resolves the path projectLink() emits", async () => {
    const { pathname } = new URL(projectLink("PRJ-PLX-MC-FRONTIER"));
    const id = decodeURIComponent(pathname.replace(/^\/projects\//, ""));
    expect(await projectTarget(id)).toBe("/?screen=project&projectId=PRJ-PLX-MC-FRONTIER");
  });

  it.each(["prj-x", "PRJ-", "PRJ-a", "BKT-X", "TASK-1", "PRJ-X/../y", "https://evil.example"])(
    "sends a malformed id %j home",
    async (id) => {
      expect(await projectTarget(id)).toBe("/");
    }
  );
});

describe("/buckets/[id] deep link (TASK-3442)", () => {
  beforeEach(() => m.redirect.mockReset());

  it("redirects a BKT id to the bucket screen the shell reads", async () => {
    const url = await bucketTarget("BKT-REVIEW-PROCESS");
    expect(url).toBe("/?screen=bucket&bucketId=BKT-REVIEW-PROCESS");
    expect(urlToRoute(url)).toEqual({ screen: "bucket", bucketId: "BKT-REVIEW-PROCESS" });
  });

  it("accepts the digit and trailing-hyphen ids the store holds", async () => {
    expect(await bucketTarget("BKT-P4-P5-EXTRACT-SOAK")).toBe(
      "/?screen=bucket&bucketId=BKT-P4-P5-EXTRACT-SOAK"
    );
    m.redirect.mockReset();
    expect(await bucketTarget("BKT-PORTAL-IDENTITY-SESSION-")).toBe(
      "/?screen=bucket&bucketId=BKT-PORTAL-IDENTITY-SESSION-"
    );
  });

  it("resolves the path bucketLink() emits", async () => {
    const { pathname } = new URL(bucketLink("BKT-INFRA"));
    const id = decodeURIComponent(pathname.replace(/^\/buckets\//, ""));
    expect(await bucketTarget(id)).toBe("/?screen=bucket&bucketId=BKT-INFRA");
  });

  it.each(["bkt-x", "BKT-", "BKT-a", "PRJ-X", "TASK-1", "BKT-X/../y", "https://evil.example"])(
    "sends a malformed id %j home",
    async (id) => {
      expect(await bucketTarget(id)).toBe("/");
    }
  );
});
