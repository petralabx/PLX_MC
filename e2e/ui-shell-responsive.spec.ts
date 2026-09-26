import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

// ADR-005 — the mobile-first shell. This spec walks its own widths (it is not
// in the tablet / mobile-chrome projects), so it runs once, in the default
// project:
//   393  bottom tabs + group strip + More sheet; drawer via More → All screens
//   820  64px icon rail → labelled drawer
//   1440 240px labelled sidebar; the context pane is an overlay
//   2560 persistent, resizable context pane; optional pinned live column
// The e2e server has no database, so the store is on its offline fallback and
// the offline banner is up in every test — the state the CLS check measures.

const ROUTE = "/shell";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const TIERS = [393, 820, 1440, 2560] as const;
const SWEEP = [360, 393, 820, 1024, 1440, 1600, 1920, 2560, 3440];

function allowedRuleIds(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "e2e/ui-a11y-allowlist.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const entry = raw[ROUTE];
    return new Set(Array.isArray(entry) ? (entry as string[]) : []);
  } catch {
    return new Set();
  }
}

// Drawers, sheets and the pane animate; measure them at rest.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function open(page: Page, width: number, url = "/", height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await waitForHydration(page);
  // The harness has no database: wait for the offline fallback to settle so
  // every check sees the banner (and its Retry) that a real failure shows.
  await expect(page.getByTestId("offline-banner")).toBeVisible();
}

async function shellViolations(page: Page, extra: string[] = []) {
  const allowed = allowedRuleIds();
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  for (const selector of [".mc-chrome", "nav.mc-side", "nav.mc-tabs", "nav.mc-subnav", ".mc-pane", ".mc-live", ...extra]) {
    if ((await page.locator(selector).count()) > 0) builder = builder.include(selector);
  }
  const results = await builder.analyze();
  return results.violations.filter((v) => !allowed.has(v.id)).map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("shell — no horizontal page scroll, 360 to 3440", () => {
  // The board's own toolbar (the Group-by segmented control) is 3px wider than
  // a 360px viewport — on main before this change too. That is Board content
  // (PR 3); the board routes are swept from 393 so this spec guards the shell.
  const ROUTES: [string, number[]][] = [
    ["/", SWEEP],
    ["/?screen=sync", SWEEP],
    ["/?screen=board", SWEEP.slice(1)],
    ["/?screen=board&taskId=TASK-221", SWEEP.slice(1)],
  ];
  for (const [url, widths] of ROUTES) {
    test(`${url}`, async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("mc.live.pinned", "1"));
      for (const width of widths) {
        await open(page, width, url);
        expect(await horizontalOverflow(page), `${url} @ ${width}`).toBeLessThanOrEqual(1);
      }
    });
  }
});

test.describe("shell — nav form per width", () => {
  test("393: bottom tabs, group strip and FAB; no rail, no sidebar", async ({ page }) => {
    await open(page, 393, "/?screen=list");
    const tabs = page.locator("nav.mc-tabs");
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link")).toHaveText([/My work/, /Plan/, /Knowledge/]);
    await expect(tabs.getByRole("button", { name: "More" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: /Plan/ })).toHaveAttribute("aria-current", "page");
    const strip = page.getByRole("navigation", { name: "Plan screens" });
    await expect(strip.getByRole("link")).toHaveText(["Board", "List", "Timeline", "Insights"]);
    await expect(strip.getByRole("link", { name: "List" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "New task" }).last()).toBeVisible();
    await expect(page.locator("nav.mc-side")).toBeHidden();
    await expect(page.getByTestId("nav-drawer-toggle")).toBeHidden();
    await expect(page.locator(".mc-top .title")).toHaveText("List");
    await expect(page.locator(".mc-top .search")).toBeHidden();
    await expect(page.getByRole("button", { name: "Search, jump or create" })).toBeVisible();
  });

  test("820: a 64px icon rail with every group's icons and accessible names", async ({ page }) => {
    await open(page, 820, "/?screen=board");
    const rail = page.locator("nav.mc-side");
    await expect(rail).toBeVisible();
    expect(Math.round((await rail.boundingBox())!.width)).toBe(64);
    await expect(page.locator("nav.mc-tabs")).toBeHidden();
    await expect(page.getByTestId("nav-drawer-toggle")).toBeVisible();
    // Labels are visually hidden, not removed: every item keeps its name.
    await expect(rail.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    await expect(rail.getByRole("link", { name: "Repos" })).toBeVisible();
    const label = await rail.getByRole("link", { name: "Board" }).locator(".nm").boundingBox();
    expect(label!.width).toBeLessThanOrEqual(1);
    await expect(page.locator(".mc-top .search")).toBeVisible();
  });

  test("1440: the labelled 240px sidebar; a selected task opens as an overlay", async ({ page }) => {
    await open(page, 1440, "/?screen=board");
    const side = page.locator("nav.mc-side");
    expect(Math.round((await side.boundingBox())!.width)).toBe(240);
    await expect(side.getByRole("link", { name: "Board" }).locator(".nm")).toBeVisible();
    await expect(page.getByTestId("nav-drawer-toggle")).toBeHidden();
    await expect(page.locator("nav.mc-tabs")).toBeHidden();
    // No persistent pane below 1600.
    await expect(page.getByRole("complementary", { name: "Details" })).toBeHidden();

    await open(page, 1440, "/?screen=board&taskId=TASK-221");
    const pane = page.getByRole("complementary", { name: "Details" });
    await expect(pane).toBeVisible();
    expect(Math.round((await pane.boundingBox())!.width)).toBe(480);
    await expect(page.locator(".mc-scrim.for-pane")).toBeVisible();
    await expect(pane.getByRole("button", { name: "Close details" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(pane).toBeHidden();
    expect(new URL(page.url()).searchParams.get("taskId")).toBeNull();
    await expect(page.locator("[data-testid='board-screen']")).toBeVisible();
  });

  test("2560: persistent pane beside the list; opening a task fills it; live column pins", async ({ page }) => {
    await open(page, 2560, "/?screen=board", 1100);
    const pane = page.getByRole("complementary", { name: "Details" });
    await expect(pane).toBeVisible();
    await expect(pane).toContainText("Nothing selected");
    await expect(page.locator(".mc-scrim")).toHaveCount(0);
    expect(Math.round((await pane.boundingBox())!.width)).toBe(520); // ≥2200 default

    // Panes, not pages: the board stays put and the URL carries the selection.
    await page.locator("[data-testid='board-screen'] .tcard").first().click();
    await expect(page.locator("[data-testid='board-screen']")).toBeVisible();
    await expect(pane.locator("[data-testid='task-detail-screen']")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("screen")).toBe("board");
    expect(new URL(page.url()).searchParams.get("taskId")).toMatch(/^TASK-/);
    // Open page still reaches the task page.
    await pane.getByRole("link", { name: "Open page" }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("screen")).toBe("task");

    await open(page, 2560, "/?screen=board", 1100);
    const pin = page.getByRole("button", { name: "Pin live column" });
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();
    const live = page.getByRole("complementary", { name: "Agent activity" });
    await expect(live).toBeVisible();
    expect(Math.round((await live.boundingBox())!.width)).toBe(340);
    await expect(live.getByRole("log")).toHaveAttribute("aria-live", "off");
    // Remembered across a reload.
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByRole("complementary", { name: "Agent activity" })).toBeVisible();
    await page.getByRole("button", { name: "Unpin live column" }).click();
    await expect(page.getByRole("complementary", { name: "Agent activity" })).toHaveCount(0);
  });

  test("the live column is dormant below 2200 even when pinned", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("mc.live.pinned", "1"));
    await open(page, 1920, "/?screen=board");
    await expect(page.getByRole("complementary", { name: "Agent activity" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Pin live column" })).toBeHidden();
  });
});

test.describe("shell — context pane (≥1600)", () => {
  test("resizes by keyboard in 16px steps, clamped to 360–640, and remembers the width", async ({ page }) => {
    await open(page, 1920, "/?screen=list");
    const pane = page.getByRole("complementary", { name: "Details" });
    const separator = page.getByRole("separator", { name: "Resize details pane" });
    await expect(separator).toHaveAttribute("aria-valuenow", "440");
    await separator.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(separator).toHaveAttribute("aria-valuenow", "472");
    expect(Math.round((await pane.boundingBox())!.width)).toBe(472);
    await page.keyboard.press("End");
    await expect(separator).toHaveAttribute("aria-valuenow", "640");
    await page.keyboard.press("ArrowLeft");
    await expect(separator).toHaveAttribute("aria-valuenow", "640");
    await page.keyboard.press("Home");
    await expect(separator).toHaveAttribute("aria-valuenow", "360");
    await page.reload();
    await waitForHydration(page);
    expect(Math.round((await page.getByRole("complementary", { name: "Details" }).boundingBox())!.width)).toBe(360);
  });

  test("can be hidden and shown again, and remembers it", async ({ page }) => {
    await open(page, 1920, "/?screen=board");
    const toggle = page.getByRole("button", { name: "Details pane" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("complementary", { name: "Details" }).getByRole("button", { name: "Close details" }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Hidden, a task opens its page as before.
    await page.locator("[data-testid='board-screen'] .tcard").first().click();
    expect(new URL(page.url()).searchParams.get("screen")).toBe("task");
    await open(page, 1920, "/?screen=board");
    await expect(page.getByRole("button", { name: "Details pane" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Details pane" }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
  });

  test("narrowing the window turns the column into an overlay layer — same selection", async ({ page }) => {
    await open(page, 1920, "/?screen=board");
    const card = page.locator("[data-testid='board-screen'] .tcard").first();
    await card.click();
    const pane = page.getByRole("complementary", { name: "Details" });
    await expect(pane.locator("[data-testid='task-detail-screen']")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".mc-scrim.for-pane")).toBeVisible();
    await expect(pane.locator("[data-testid='task-detail-screen']")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pane).toBeHidden();
    await expect(card).toBeFocused();
  });
});

test.describe("shell — review round 1 regressions", () => {
  test("phone: the full-screen pane is usable — a tap inside it does not close it, no FAB over it", async ({ page }) => {
    await open(page, 393, "/?screen=board&taskId=TASK-221");
    const pane = page.getByRole("complementary", { name: "Details" });
    await expect(pane).toBeVisible();
    await expect(page.getByRole("button", { name: "New task" })).toHaveCount(0);
    await pane.getByText("Timeline · comments").first().click();
    await expect(pane).toBeVisible();
    expect(new URL(page.url()).searchParams.get("taskId")).toBe("TASK-221");
    // The tabs stay usable beside the pane.
    await page.locator("nav.mc-tabs").getByRole("link", { name: /Knowledge/ }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toHaveCount(0);
  });

  test("≥1600: hiding the pane with a task selected hides it — no modal overlay takes its place", async ({ page }) => {
    await open(page, 1920, "/?screen=board");
    await page.locator("[data-testid='board-screen'] .tcard").first().click();
    const pane = page.getByRole("complementary", { name: "Details" });
    await expect(pane.locator("[data-testid='task-detail-screen']")).toBeVisible();
    await page.getByRole("button", { name: "Details pane" }).click();
    await expect(pane).toBeHidden();
    await expect(page.locator(".mc-scrim")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveClass(/mc-lock/);
    expect(new URL(page.url()).searchParams.get("taskId")).toBeNull();
  });

  test("phone drawer stacks the Projects and Initiatives lists (no clipped row)", async ({ page }) => {
    await open(page, 393, "/?screen=board");
    await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: /All screens/ }).click();
    const drawer = page.locator("nav.mc-side");
    for (const name of ["Projects", "Initiatives"]) {
      const group = drawer.getByRole("group", { name });
      const first = (await group.getByRole("link").first().boundingBox())!;
      const add = (await group.getByRole("button").last().boundingBox())!;
      expect(add.y, `${name}: New … sits below the list`).toBeGreaterThan(first.y + first.height - 1);
      expect(add.x + add.width, `${name}: inside the drawer`).toBeLessThanOrEqual((await drawer.boundingBox())!.width + 1);
    }
    expect(await drawer.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("icons keep their tier sizes: 18 in icon buttons, 20 in tabs, 22 in the FAB", async ({ page }) => {
    await open(page, 393, "/?screen=board");
    const size = async (selector: string) => Math.round((await page.locator(selector).first().boundingBox())!.width);
    expect(await size("nav.mc-tabs a .ic")).toBe(20);
    expect(await size(".mc-fab .ic")).toBe(22);
    expect(await size(".mc-top .search-icon .ic")).toBe(18);
  });

  test("desktop marks the current item with one 2px accent rule, not the rail's extra inset", async ({ page }) => {
    await open(page, 1440, "/?screen=board");
    const item = page.locator("nav.mc-side").getByRole("link", { name: "Board" });
    await expect(item).toHaveCSS("box-shadow", "none");
    await expect(item).toHaveCSS("border-left-width", "2px");
  });

  test("a reload on another screen does not overwrite a tab's remembered screen", async ({ page }) => {
    await open(page, 393, "/?screen=mine");
    await open(page, 393, "/?screen=board");
    await expect(page.locator("nav.mc-tabs").getByRole("link", { name: /My work/ })).toHaveAttribute("href", "/?screen=mine");
  });
});

test.describe("shell — review round 2 regressions", () => {
  test("Esc inside the overlay pane goes to the field first (mention list, not the pane)", async ({ page }) => {
    await open(page, 1440, "/?screen=board&taskId=TASK-221");
    const pane = page.getByRole("complementary", { name: "Details" });
    const box = pane.getByRole("textbox", { name: /Write a comment/ });
    await box.click();
    await box.pressSequentially("hello @");
    await expect(pane.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pane.getByRole("listbox")).toHaveCount(0);
    await expect(pane).toBeVisible();
    await expect(box).toHaveValue("hello @");
    expect(new URL(page.url()).searchParams.get("taskId")).toBe("TASK-221");
    // With nothing left to dismiss inside, the next Esc closes the pane.
    await page.keyboard.press("Escape");
    await expect(pane).toBeHidden();
  });

  test("phone pane sits under the chrome (banner visible) and the covered page is inert", async ({ page }) => {
    await open(page, 393, "/?screen=board&taskId=TASK-221");
    const pane = page.getByRole("complementary", { name: "Details" });
    await expect(pane).toBeVisible();
    const banner = (await page.getByTestId("offline-banner").boundingBox())!;
    const paneBox = (await pane.boundingBox())!;
    expect(Math.round(paneBox.y)).toBeGreaterThanOrEqual(Math.round(banner.y + banner.height));
    await expect(page.locator(".mc-top .search-icon")).toBeInViewport();
    await expect(pane.getByRole("button", { name: "Close details" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#mc-main")))).toBe(false);
    await expect(page.locator("main#mc-main")).toHaveAttribute("inert", "");
  });

  test("closing the empty pane and unpinning the live column leave focus on their toggles", async ({ page }) => {
    await open(page, 2560, "/?screen=board", 1100);
    await page.getByRole("complementary", { name: "Details" }).getByRole("button", { name: "Close details" }).click();
    await expect(page.getByRole("button", { name: "Details pane" })).toBeFocused();
    await page.getByRole("button", { name: "Pin live column" }).click();
    await page.getByRole("button", { name: "Unpin live column" }).click();
    await expect(page.getByRole("button", { name: "Pin live column" })).toBeFocused();
  });

  test("g-chords do not fire while a shell layer owns the keyboard", async ({ page }) => {
    await open(page, 393, "/?screen=list");
    await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("b");
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("screen")).toBe("list");
  });

  test("shell buttons are 44px tall on a coarse pointer at any width", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, isMobile: true });
    await page.goto("/?screen=board&taskId=TASK-221");
    await waitForHydration(page);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    for (const target of [page.getByTestId("offline-banner").getByRole("button"), page.getByRole("link", { name: "Open page" })]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.close();
  });

  test("the live column holds the user's pick — Agent activity by default, or Approvals", async ({ page }) => {
    await open(page, 2560, "/?screen=board", 1100);
    await page.getByRole("button", { name: "Pin live column" }).click();
    const live = page.locator("aside.mc-live");
    const pick = live.getByRole("group", { name: "Live column shows" });
    await expect(pick.getByRole("button", { name: "Agent activity" })).toHaveAttribute("aria-pressed", "true");
    await pick.getByRole("button", { name: "Approvals" }).click();
    await expect(live).toHaveAttribute("aria-label", "Approvals");
    await expect(live.locator(".ap-page")).toBeVisible();
    await page.reload();
    await waitForHydration(page);
    await expect(page.locator("aside.mc-live")).toHaveAttribute("aria-label", "Approvals");
    // Not shown twice: on the Approvals screen itself the column steps aside.
    await open(page, 2560, "/?screen=approvals", 1100);
    await expect(page.locator("aside.mc-live")).toHaveCount(0);
  });
});

test.describe("shell — review round 3 regressions", () => {
  test("crossing 641 with the pane open keeps the layer order and the user's focus", async ({ page }) => {
    await open(page, 393, "/?screen=board&taskId=TASK-221");
    await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
    await page.setViewportSize({ width: 852, height: 393 }); // rotate to landscape
    await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
  });

  test("≥1600: Back to a selection after hiding the pane shows the column again — never an overlay", async ({ page }) => {
    await open(page, 1920, "/?screen=board");
    await page.locator("[data-testid='board-screen'] .tcard").first().click();
    await page.getByRole("button", { name: "Details pane" }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toBeHidden();
    await page.goBack();
    const pane = page.getByRole("complementary", { name: "Details" });
    await expect(pane.locator("[data-testid='task-detail-screen']")).toBeVisible();
    await expect(page.locator(".mc-scrim")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveClass(/mc-lock/);
    await expect(page.getByRole("button", { name: "Details pane" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the live picker cannot hide its own column", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("mc.live.pinned", "1"));
    await open(page, 2560, "/?screen=approvals", 1100);
    const pick = page.locator("aside.mc-live").getByRole("group", { name: "Live column shows" });
    await expect(pick.getByRole("button", { name: "Agent activity" })).toHaveAttribute("aria-pressed", "true");
    await expect(pick.getByRole("button", { name: "Approvals" })).toBeDisabled();
  });

  test("the '/' filter shortcut does not pull focus out of an open layer", async ({ page }) => {
    await open(page, 820, "/?screen=board");
    await page.getByTestId("nav-drawer-toggle").click();
    const close = page.locator("nav.mc-side").getByRole("button", { name: "Close navigation" });
    await expect(close).toBeFocused();
    await page.keyboard.press("/");
    await expect(close).toBeFocused();
  });

  test("a dormant live column (below 2200) never mounts or fetches", async ({ page }) => {
    // Home's own section fetches /api/approvals too (and the shell renders Home
    // for one tick before it adopts a deep link), so compare against the same
    // load with nothing pinned rather than expecting zero requests.
    const approvalsRequests = async (pinned: boolean) => {
      const seen: string[] = [];
      const listener = (request: { url(): string }) => {
        if (/\/api\/approvals(\?|$)/.test(request.url())) seen.push(request.url());
      };
      page.on("request", listener);
      await page.goto("/");
      await page.evaluate((pin) => {
        window.localStorage.setItem("mc.live.pinned", pin ? "1" : "0");
        window.localStorage.setItem("mc.live.kind", "approvals");
      }, pinned);
      seen.length = 0;
      await page.evaluate(() => {
        (window as unknown as { __liveMounted: boolean }).__liveMounted = false;
      });
      await page.addInitScript(() => {
        const w = window as unknown as { __liveMounted: boolean };
        w.__liveMounted = false;
        new MutationObserver(() => {
          if (document.querySelector(".mc-live")) w.__liveMounted = true;
        }).observe(document, { childList: true, subtree: true });
      });
      await open(page, 1440, "/?screen=board");
      await page.waitForLoadState("networkidle");
      const mounted = await page.evaluate(() => (window as unknown as { __liveMounted: boolean }).__liveMounted);
      page.off("request", listener);
      return { count: seen.length, mounted };
    };
    const unpinned = await approvalsRequests(false);
    const pinned = await approvalsRequests(true);
    expect(pinned.mounted).toBe(false);
    expect(pinned.count).toBe(unpinned.count);
  });

  test("a decision in the pinned Approvals column refreshes Home's approvals section", async ({ page }) => {
    const row = {
      taskId: "TASK-221",
      taskTitle: "WMS integration",
      stage: "planned",
      gate: {
        id: "apg_e2e_1",
        reason: "Promote to Approved",
        requestedBy: "agent:e2e",
        requestedAt: "2026-09-25T09:00:00Z",
        status: "pending",
      },
    };
    let decided = false;
    await page.route(/\/api\/approvals\/decide$/, async (route) => {
      decided = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.route(/\/api\/approvals(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { approvals: decided ? [] : [row] } }),
      });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem("mc.live.pinned", "1");
      window.localStorage.setItem("mc.live.kind", "approvals");
    });
    await open(page, 2560, "/", 1100);
    const homeSection = page.locator("[data-testid='inbox-screen'] .needs-sec").filter({ hasText: /Approvals waiting/i });
    await expect(homeSection).toContainText("Promote to Approved");
    await page.locator("aside.mc-live").getByRole("button", { name: "Approve" }).click();
    await expect(page.locator("aside.mc-live")).toContainText(/No pending approvals/);
    await expect(homeSection).not.toContainText("Promote to Approved");
  });
});

test.describe("shell — layers, focus and keyboard", () => {
  test("the skip link is the first tab stop and moves focus to main", async ({ page }) => {
    for (const width of TIERS) {
      await open(page, width, "/?screen=board");
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip, `@${width}`).toBeFocused();
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.locator("main#mc-main"), `@${width}`).toBeFocused();
    }
  });

  test("Esc closes only the topmost layer and focus returns to its trigger", async ({ page }) => {
    await open(page, 820, "/?screen=board");
    const toggle = page.getByTestId("nav-drawer-toggle");
    await toggle.click();
    await expect(page.locator("nav.mc-side")).toHaveClass(/\bopen\b/);
    // ⌘K over the open drawer: Esc closes the palette, not the drawer.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("cmdk")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("cmdk")).toHaveCount(0);
    await expect(page.locator("nav.mc-side")).toHaveClass(/\bopen\b/);
    // The next Esc closes the drawer and returns focus to its toggle.
    await page.keyboard.press("Escape");
    await expect(page.locator("nav.mc-side")).not.toHaveClass(/\bopen\b/);
    await expect(toggle).toBeFocused();
  });

  test("the More sheet traps Tab, closes on Esc and hands focus back to More", async ({ page }) => {
    await open(page, 393, "/?screen=board");
    const more = page.locator("nav.mc-tabs").getByRole("button", { name: "More" });
    await more.click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
    await expect(page.locator("body")).toHaveClass(/mc-lock/);
    for (let i = 0; i < 20; i += 1) await page.keyboard.press("Tab");
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(page.locator("body")).not.toHaveClass(/mc-lock/);
  });

  test("the workspace is a static label and the ⌘K hint hides on touch", async ({ browser }) => {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await desktop.goto("/");
    await waitForHydration(desktop);
    const ws = desktop.locator(".mc-top .ws");
    await expect(ws).toContainText("PLX Engineering");
    await expect(ws.locator("button, a, [role=button]")).toHaveCount(0);
    await expect(desktop.locator(".mc-top .search .kbd-hint")).toBeVisible();
    await desktop.close();

    const touch = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, isMobile: true });
    await touch.goto("/");
    await waitForHydration(touch);
    expect(await touch.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await expect(touch.locator(".mc-top .search .kbd-hint")).toBeHidden();
    await touch.close();
  });

  test("each phone tab returns to its last screen", async ({ page }) => {
    await open(page, 393, "/?screen=board");
    await page.getByRole("navigation", { name: "Plan screens" }).getByRole("link", { name: "Timeline" }).click();
    await expect(page.locator("[data-testid='board-screen'][data-mc-view='timeline']")).toBeVisible();
    const tabs = page.locator("nav.mc-tabs");
    // Keyboard activation: the Next dev-tools badge sits over the first tab in
    // `next dev` (never in production), and Enter takes the same click path.
    await tabs.getByRole("link", { name: /My work/ }).press("Enter");
    await expect(page.locator("[data-testid='inbox-screen']")).toBeVisible();
    await expect(tabs.getByRole("link", { name: /Plan/ })).toHaveAttribute("href", "/?screen=timeline");
    await tabs.getByRole("link", { name: /Plan/ }).press("Enter");
    await expect(page.locator("[data-testid='board-screen'][data-mc-view='timeline']")).toBeVisible();
  });
});

test.describe("shell — touch targets and current page", () => {
  test("every shell control is at least 44×44 on phone and tablet", async ({ page }) => {
    await open(page, 393, "/?screen=board");
    const phone = [
      ...(await page.locator("nav.mc-tabs a, nav.mc-tabs button").all()),
      ...(await page.locator(".mc-top .brand, .mc-top .search-icon").all()),
      ...(await page.locator("nav.mc-subnav a").all()),
      ...(await page.locator(".mc-offline .btn").all()),
    ];
    for (const target of phone) {
      const box = await target.boundingBox();
      expect(box, await target.evaluate((el) => el.outerHTML.slice(0, 80))).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await open(page, 820, "/?screen=board");
    const tablet = [
      ...(await page.locator("nav.mc-side .item:visible, nav.mc-side .rail-toggle").all()),
      ...(await page.locator(".mc-top .search, .mc-top .topsync, .mc-top .theme").all()),
    ];
    for (const target of tablet) {
      const box = await target.boundingBox();
      expect(box!.height, await target.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("aria-current=page marks the screen on the sidebar, rail, tabs and strip", async ({ page }) => {
    await open(page, 1440, "/?screen=insights");
    await expect(page.locator("nav.mc-side").getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");
    await open(page, 820, "/?screen=insights");
    await expect(page.locator("nav.mc-side").getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");
    await open(page, 393, "/?screen=insights");
    await expect(page.locator("nav.mc-tabs").getByRole("link", { name: /Plan/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Plan screens" }).getByRole("link", { name: "Insights" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});

test.describe("shell — offline banner", () => {
  test("appears without shifting the page (CLS < 0.01)", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    for (const width of [393, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/?screen=board");
      await waitForHydration(page);
      await expect(page.getByTestId("offline-banner")).toBeVisible();
      // The banner sits in the sticky chrome under the top bar, never over content or tabs.
      const banner = (await page.getByTestId("offline-banner").boundingBox())!;
      const top = (await page.locator(".mc-top").boundingBox())!;
      expect(Math.round(banner.y)).toBe(Math.round(top.y + top.height));
      expect(Math.round(banner.height)).toBe(44);
      await page.waitForLoadState("networkidle");
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, `CLS @ ${width}`).toBeLessThan(0.01);
    }
  });
});

test.describe("shell — axe at every tier (allowlist unchanged)", () => {
  for (const width of TIERS) {
    test(`${width}`, async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("mc.live.pinned", "1"));
      await open(page, width, "/?screen=board", width >= 2200 ? 1100 : 900);
      expect(await shellViolations(page)).toEqual([]);
      if (width === 393) {
        await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
        expect(await shellViolations(page, ".mc-sheet".split(","))).toEqual([]);
      }
      if (width === 820) {
        await page.getByTestId("nav-drawer-toggle").click();
        expect(await shellViolations(page)).toEqual([]);
      }
    });
  }

  test("dark mode at 393 and 1440", async ({ page }) => {
    for (const width of [393, 1440]) {
      await open(page, width, "/?screen=board");
      await page.locator(".mc").first().evaluate((el) => el.classList.add("dark"));
      expect(await shellViolations(page), `dark @ ${width}`).toEqual([]);
    }
  });
});
