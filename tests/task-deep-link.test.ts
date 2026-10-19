import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));

import TaskDeepLink from "@/app/tasks/[id]/page";
import { urlToRoute } from "@/components/mc/route";
import { taskLink } from "@/lib/mcp/envelope";

async function target(id: string): Promise<string> {
  await TaskDeepLink({ params: Promise.resolve({ id }) });
  expect(m.redirect).toHaveBeenCalledTimes(1);
  return m.redirect.mock.calls[0][0];
}

describe("/tasks/[id] deep link (TASK-3163)", () => {
  beforeEach(() => m.redirect.mockReset());

  it("redirects a TASK id to the task screen the shell reads", async () => {
    const url = await target("TASK-3163");
    expect(url).toBe("/?screen=task&taskId=TASK-3163");
    expect(urlToRoute(url)).toEqual({ screen: "task", taskId: "TASK-3163" });
  });

  it("resolves the path taskLink() emits", async () => {
    const { pathname } = new URL(taskLink("TASK-1"));
    const id = decodeURIComponent(pathname.replace(/^\/tasks\//, ""));
    expect(await target(id)).toBe("/?screen=task&taskId=TASK-1");
  });

  it.each(["task-1", "TASK-", "TASK-1x", "1", "TASK-1/../x", "https://evil.example"])(
    "sends a malformed id %j home",
    async (id) => {
      expect(await target(id)).toBe("/");
    }
  );
});
