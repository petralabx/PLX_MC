import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { openSidebar, waitForHydration } from "./helpers";

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
    await expect(rail.getByRole("link", { name: "Board", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(rail.getByRole("link", { name: "Repos" })).toBeVisible();
    const label = await rail.getByRole("link", { name: "Board", exact: true }).locator(".nm").boundingBox();
    expect(label!.width).toBeLessThanOrEqual(1);
    await expect(page.locator(".mc-top .search")).toBeVisible();
  });

  test("1440: the labelled 240px sidebar; a selected task opens as an overlay", async ({ page }) => {
    await open(page, 1440, "/?screen=board");
    const side = page.locator("nav.mc-side");
    expect(Math.round((await side.boundingBox())!.width)).toBe(240);
    await expect(side.getByRole("link", { name: "Board", exact: true }).locator(".nm")).toBeVisible();
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
    const item = page.locator("nav.mc-side").getByRole("link", { name: "Board", exact: true });
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
    // Home's own section fetches /api/approvals too, and the shell renders Home
    // for one tick before it adopts a deep link, so a raw request count varies
    // run to run. Instead, flag every /api/approvals call made while a live
    // column is in the DOM, and track whether one ever mounts.
    await page.addInitScript(() => {
      const w = window as unknown as { __liveMounted: boolean; __liveFetches: number };
      w.__liveMounted = false;
      w.__liveFetches = 0;
      new MutationObserver(() => {
        if (document.querySelector(".mc-live")) w.__liveMounted = true;
      }).observe(document, { childList: true, subtree: true });
      const original = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (/\/api\/approvals(\?|$)/.test(url) && document.querySelector(".mc-live")) w.__liveFetches += 1;
        return original(input, init);
      };
    });
    const load = async (width: number) => {
      await page.goto("/");
      await page.evaluate(() => {
        window.localStorage.setItem("mc.live.pinned", "1");
        window.localStorage.setItem("mc.live.kind", "approvals");
      });
      await open(page, width, "/?screen=board", width >= 2200 ? 1100 : 900);
      await page.waitForLoadState("networkidle");
      return page.evaluate(() => {
        const w = window as unknown as { __liveMounted: boolean; __liveFetches: number };
        return { mounted: w.__liveMounted, fetches: w.__liveFetches };
      });
    };
    // Control: at 2560 the pinned column mounts and its fetch is seen.
    const ultra = await load(2560);
    expect(ultra.mounted).toBe(true);
    expect(ultra.fetches).toBeGreaterThan(0);
    // Below 2200 the same preference stays dormant.
    const wide = await load(1440);
    expect(wide.mounted).toBe(false);
    expect(wide.fetches).toBe(0);
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
    // TASK-3721: questions and gates share one queue, so its empty state needs both lists.
    await page.route(/\/api\/questions(\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { questions: [] } }) });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem("mc.live.pinned", "1");
      window.localStorage.setItem("mc.live.kind", "approvals");
    });
    await open(page, 2560, "/", 1100);
    const homeSection = page.locator("[data-testid='inbox-screen'] .needs-sec").filter({ hasText: /Approvals waiting/i });
    await expect(homeSection).toContainText("Promote to Approved");
    // The narrow column shows the queue; a row opens its decision sheet.
    const live = page.locator("aside.mc-live");
    await live.locator(".ap-item", { hasText: "Promote to Approved" }).click();
    await live.getByTestId("decision-sheet").getByRole("button", { name: "Approve", exact: true }).click();
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

  // TASK-3837: a deep link to an initiative low in the list shows its row by
  // scrolling the sidebar, never the page, and lights its parent project.
  test("a deep link scrolls the sidebar, not the page, to the current initiative", async ({ page }) => {
    await open(page, 1440, "/?screen=bucket&bucketId=BKT-UAT", 520);
    const side = page.locator("nav.mc-side");
    const row = side.getByRole("link", { name: "UAT", exact: true });
    await expect(row).toHaveAttribute("aria-current", "page");
    await expect(row).toBeInViewport({ ratio: 1 });
    expect(await side.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(side.getByRole("link", { name: "PLX Portal Go-Live" })).toHaveClass(/\bon-path\b/);
  });

  test("on a phone, the drawer opens on the current initiative with its close button in view", async ({ page }) => {
    await open(page, 393, "/?screen=bucket&bucketId=BKT-UAT", 700);
    await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: /All screens/ }).click();
    const side = page.locator("nav.mc-side");
    await expect(side).toHaveClass(/\bopen\b/);
    await expect(side.getByRole("link", { name: "UAT", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(side.getByRole("button", { name: "Close navigation" })).toBeInViewport({ ratio: 1 });
  });

  test("on a tablet, the rail keeps its expand toggle and the drawer opens on the current initiative", async ({ page }) => {
    await open(page, 820, "/?screen=bucket&bucketId=BKT-UAT", 600);
    const side = page.locator("nav.mc-side");
    const toggle = page.getByTestId("nav-drawer-toggle");
    await expect(toggle).toBeInViewport({ ratio: 1 });
    expect(await side.evaluate((el) => el.scrollTop)).toBe(0);
    await toggle.click();
    await expect(side).toHaveClass(/\bopen\b/);
    await expect(side.getByRole("link", { name: "UAT", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(side.getByRole("button", { name: "Close navigation" })).toBeInViewport({ ratio: 1 });
  });

  // WCAG 2.4.11: the sticky drawer head never hides the focused row, and it
  // sits flush with the drawer's top edge, so nothing scrolls above it.
  test("in the phone drawer, the sticky head never covers keyboard focus or leaves a gap", async ({ page }) => {
    await open(page, 393, "/?screen=bucket&bucketId=BKT-UAT", 700);
    await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: /All screens/ }).click();
    const side = page.locator("nav.mc-side");
    await expect(side).toHaveClass(/\bopen\b/);
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Shift+Tab");
      const hidden = await page.evaluate(() => {
        const nav = document.querySelector("nav.mc-side")!;
        const head = nav.querySelector(".side-head")!;
        const focused = document.activeElement as HTMLElement | null;
        if (!focused || !nav.contains(focused) || head.contains(focused)) return null;
        // The 4px focus ring (2px outline, 2px offset) must clear the head too.
        return focused.getBoundingClientRect().top + 0.5 < head.getBoundingClientRect().bottom + 4 ? focused.textContent : null;
      });
      expect(hidden, `focus hidden under the head after ${i + 1} Shift+Tab`).toBeNull();
    }
    await side.evaluate((el) => {
      el.scrollTop = 300;
    });
    const gap = await side.evaluate((el) => el.querySelector(".side-head")!.getBoundingClientRect().top - el.getBoundingClientRect().top);
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
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

// TASK-3840 — the zoned sidebar (portal ADR-011). The build flag is off here;
// these tests opt in per browser, as UAT does (localStorage mc.nav.zones).
test.describe("shell — zoned sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("mc.nav.zones", "1"));
  });

  const side = (page: Page) => page.locator("nav.mc-side");
  const flyout = (page: Page) => page.locator("#mc-nav-admin-flyout");
  const footToggle = (page: Page) => side(page).getByRole("button", { name: "Admin & health" });

  async function openDrawer(page: Page, width: number) {
    if (width < 641) {
      await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
      await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: /All screens/ }).click();
    } else {
      await page.getByTestId("nav-drawer-toggle").click();
    }
    await expect(side(page)).toHaveClass(/\bopen\b/);
  }

  test("no horizontal page scroll, 360 to 3440", async ({ page }) => {
    for (const width of SWEEP) {
      await open(page, width, "/");
      expect(await horizontalOverflow(page), `@ ${width}`).toBeLessThanOrEqual(1);
    }
  });

  test("1440: a 248px sidebar in zones, with its footer in view", async ({ page }) => {
    await open(page, 1440, "/?screen=board", 600);
    const nav = side(page);
    expect(Math.round((await nav.boundingBox())!.width)).toBe(248);
    await expect(nav.locator(".grp > .h")).toHaveText([/^My work$/, /^Plan$/, /^Reporting$/, /^Knowledge/]);
    await expect(nav.getByRole("group", { name: "Reporting", exact: true }).getByRole("link")).toHaveText([
      /^Dashboard/,
      /^Insights/,
      /^Goals & production/,
      /^AI spend/,
      /^CI scorecard/,
    ]);
    // Rows are 28px for a mouse (ADR-011).
    expect(Math.round((await nav.getByRole("link", { name: "All work", exact: true }).boundingBox())!.height)).toBe(28);
    // The list scrolls under a footer that stays put.
    expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    for (const scrollTop of [0, 10_000]) {
      await nav.evaluate((el, top) => {
        el.scrollTop = top;
      }, scrollTop);
      await expect(footToggle(page)).toBeInViewport({ ratio: 1 });
      await expect(nav.getByRole("link", { name: "Help and shortcuts" })).toBeInViewport({ ratio: 1 });
    }
  });

  test("820: the 64px rail keeps every zone's icons and the footer, 44px targets", async ({ page }) => {
    await open(page, 820, "/?screen=board");
    const nav = side(page);
    expect(Math.round((await nav.boundingBox())!.width)).toBe(64);
    await expect(nav.getByRole("link", { name: "Skills directory" })).toBeVisible();
    // The Projects tree (TASK-3841) stays in the drawer: the rail shows its icon.
    await expect(nav.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
    await expect(nav.getByRole("group", { name: "Projects", exact: true })).toBeHidden();
    for (const target of [footToggle(page), nav.getByRole("link", { name: "Help and shortcuts" })]) {
      await expect(target).toBeInViewport({ ratio: 1 });
      const box = (await target.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("the Admin & health flyout opens beside the nav, closes on Esc, outside and on navigating", async ({ page }) => {
    for (const width of [1440, 820]) {
      await open(page, width, "/?screen=board");
      const toggle = footToggle(page);
      const panel = flyout(page);
      await expect(panel).toBeHidden();
      await toggle.click();
      await expect(panel).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const nav = (await side(page).boundingBox())!;
      const box = (await panel.boundingBox())!;
      expect(box.x, `beside the nav @ ${width}`).toBeGreaterThanOrEqual(nav.x + nav.width);
      expect(Math.round(box.width)).toBe(264);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
      await expect(panel.locator(".fly-h")).toHaveText(["Operations", "Sync and data", "Engineering"]);
      expect(await shellViolations(page, ["#mc-nav-admin-flyout"]), `axe @ ${width}`).toEqual([]);

      // Esc on the toggle, or from inside the panel, closes it; focus stays on the toggle.
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await page.keyboard.press("Tab");
      await expect(panel.getByRole("link").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(toggle).toBeFocused();

      // A click outside closes it.
      await toggle.click();
      await page.locator("main#mc-main").click({ position: { x: 4, y: 4 } });
      await expect(panel).toBeHidden();

      // An item navigates and closes it; the toggle is lit on that screen.
      await toggle.click();
      await panel.getByRole("link", { name: /^Repos/ }).click();
      await expect(page.locator("[data-testid='repos-screen']")).toBeVisible();
      await expect(panel).toBeHidden();
      await expect(toggle).toHaveClass(/\bon-path\b/);
    }
  });

  // Review round 1: the flyout owns Esc from anywhere, keeps it from the
  // screen, closes when focus moves on, and sizes its icons like the shell.
  test("the flyout owns Esc, keeps it from the screen, and closes when focus moves on", async ({ page }) => {
    await open(page, 1440, "/?screen=board");
    await page.evaluate(() => {
      const w = window as unknown as { __esc: number };
      w.__esc = 0;
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") w.__esc += 1;
      });
    });
    const toggle = footToggle(page);
    const panel = flyout(page);
    await toggle.click();
    await expect(panel).toBeVisible();
    expect(Math.round((await panel.locator(".item .ic").first().boundingBox())!.width)).toBe(16);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { __esc: number }).__esc)).toBe(0);

    // Tab past the last item: focus moves on and the flyout closes. The
    // sidebar is one tab stop (TASK-3955), so Help is not next: the page is.
    await toggle.click();
    await page.keyboard.press("Tab");
    for (let i = 0; i < 20 && (await panel.isVisible()); i += 1) await page.keyboard.press("Tab");
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => !!document.activeElement?.closest("#mc-main"))).toBe(true);

    // ⌘K takes focus to the palette, and the flyout gets out of its way.
    await toggle.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("cmdk")).toBeVisible();
    await expect(panel).toBeHidden();
  });

  test("in a drawer, Esc with focus elsewhere closes the flyout, not the drawer", async ({ page }) => {
    await open(page, 820, "/?screen=board");
    await openDrawer(page, 820);
    await footToggle(page).click();
    await expect(flyout(page)).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await expect(flyout(page)).toBeHidden();
    await expect(side(page)).toHaveClass(/\bopen\b/);
  });

  test("on Help, the footer row is current and the list does not scroll", async ({ page }) => {
    await open(page, 1440, "/?screen=help", 600);
    const nav = side(page);
    await expect(nav.getByRole("link", { name: "Help and shortcuts" })).toHaveAttribute("aria-current", "page");
    expect(await nav.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test("in a drawer, Esc closes the flyout first, then the drawer", async ({ page }) => {
    await open(page, 820, "/?screen=board");
    await openDrawer(page, 820);
    await footToggle(page).click();
    await expect(flyout(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(flyout(page)).toBeHidden();
    await expect(side(page)).toHaveClass(/\bopen\b/);
    await page.keyboard.press("Escape");
    await expect(side(page)).not.toHaveClass(/\bopen\b/);
    await expect(page.getByTestId("nav-drawer-toggle")).toBeFocused();
  });

  test("393: the flyout is a sheet along the bottom of the drawer, with 44px rows", async ({ page }) => {
    await open(page, 393, "/?screen=board", 851);
    await openDrawer(page, 393);
    const toggle = footToggle(page);
    await expect(toggle).toBeInViewport({ ratio: 1 });
    await toggle.click();
    const panel = flyout(page);
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(Math.round(box.x)).toBe(12);
    expect(Math.round(box.width)).toBe(393 - 24);
    expect(Math.round(851 - (box.y + box.height))).toBe(12);
    for (const link of await panel.getByRole("link").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await shellViolations(page, ["#mc-nav-admin-flyout"])).toEqual([]);
    await panel.getByRole("link", { name: /^SharePoint sync/ }).click();
    await expect(page.locator("[data-testid='sync-console-screen']")).toBeVisible();
    await expect(panel).toBeHidden();
    await expect(side(page)).not.toHaveClass(/\bopen\b/);
  });

  // WCAG 2.4.11: the sticky footer never hides the focused row. The rows
  // are one tree (TASK-3955): Tab reaches it, ↓ walks it.
  test("in the phone drawer, the sticky footer never covers keyboard focus", async ({ page }) => {
    await open(page, 393, "/?screen=board", 700);
    await openDrawer(page, 393);
    await side(page).getByRole("link", { name: "All work" }).focus();
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("ArrowDown");
      const hidden = await page.evaluate(() => {
        const nav = document.querySelector("nav.mc-side")!;
        const foot = nav.querySelector(".side-foot")!;
        const focused = document.activeElement as HTMLElement | null;
        if (!focused || !nav.contains(focused) || foot.contains(focused)) return null;
        // The 4px focus ring (2px outline, 2px offset) must clear the footer too.
        return focused.getBoundingClientRect().bottom - 0.5 > foot.getBoundingClientRect().top - 4 ? focused.textContent : null;
      });
      expect(hidden, `focus hidden under the footer after ${i + 1} Tab`).toBeNull();
    }
  });

  test("helpers reach a Knowledge screen and an Admin & health screen at every tier", async ({ page }) => {
    for (const width of TIERS) {
      await open(page, width, "/");
      await openSidebar(page, "Skills directory");
      await expect(page.locator("[data-testid='sk-screen']"), `@ ${width}`).toBeVisible();
      await open(page, width, "/");
      await openSidebar(page, "Repos");
      await expect(page.locator("[data-testid='repos-screen']"), `@ ${width}`).toBeVisible();
      await open(page, width, "/");
      await openSidebar(page, "UAT");
      await expect(page.getByTestId("bucket-kicker"), `@ ${width}`).toContainText("Initiative · BKT-UAT");
    }
  });

  // TASK-3843: one All work row, and the zoned phone tabs.
  test("1440: All work is one row, lit on each view, and g b, g l and g t still switch views", async ({ page }) => {
    await open(page, 1440, "/?screen=list");
    const allWork = side(page).getByRole("link", { name: "All work", exact: true });
    await expect(allWork).toHaveAttribute("aria-current", "page");
    // Lit, it stays on the view it is lit for.
    await expect(allWork).toHaveAttribute("href", "/?screen=list");
    for (const label of ["Board", "List", "Timeline"]) {
      await expect(side(page).getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
    const views = page.locator(".mc-main .vsw");
    await expect(views.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    for (const [key, view] of [["t", "timeline"], ["b", "board"], ["l", "list"]] as const) {
      await page.locator("body").press("g");
      await page.locator("body").press(key);
      await expect(page.locator(`[data-testid='board-screen'][data-mc-view='${view}']`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`screen=${view}`));
      await expect(allWork).toHaveAttribute("aria-current", "page");
      await expect(allWork).toHaveAttribute("href", `/?screen=${view}`);
    }
  });

  test("393: the tabs are Home, My tasks, Projects, Search and More; Search opens ⌘K", async ({ page }) => {
    await open(page, 393, "/?screen=board");
    const tabs = page.locator("nav.mc-tabs");
    await expect(tabs.locator("a, button")).toHaveText([/^Home/, /^My tasks/, /^Projects/, /^Search/, /^More/]);
    // One row of five equal tabs, each inside the viewport, each 44px or more.
    const boxes = await tabs.locator("a, button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    const view = page.viewportSize()!;
    for (const box of boxes) {
      expect(box.top).toBe(boxes[0].top);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(view.width);
      expect(box.bottom).toBeLessThanOrEqual(view.height);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.round(box.width)).toBe(Math.round(boxes[0].width));
    }
    await expect(tabs.getByRole("link", { name: /^Projects/ })).toHaveAttribute("aria-current", "page");
    // Under Projects: All work and Projects, with All work lit on any view.
    const strip = page.getByRole("navigation", { name: "Projects screens" });
    await expect(strip.getByRole("link")).toHaveText(["All work", "Projects"]);
    await expect(strip.getByRole("link", { name: "All work" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("button", { name: "Search" }).click();
    await expect(page.getByLabel("Command palette search")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Command palette search")).toHaveCount(0);
  });

  test("393: each zoned tab returns to its last screen", async ({ page }) => {
    await open(page, 393, "/?screen=board");
    await page.locator(".mc-main .vsw").getByRole("button", { name: "Timeline" }).click();
    await expect(page.locator("[data-testid='board-screen'][data-mc-view='timeline']")).toBeVisible();
    const tabs = page.locator("nav.mc-tabs");
    await tabs.getByRole("link", { name: /^Home/ }).press("Enter");
    await expect(page.locator("[data-testid='inbox-screen']")).toBeVisible();
    await expect(tabs.getByRole("link", { name: /^Projects/ })).toHaveAttribute("href", "/?screen=timeline");
    await tabs.getByRole("link", { name: /^Projects/ }).press("Enter");
    await expect(page.locator("[data-testid='board-screen'][data-mc-view='timeline']")).toBeVisible();
  });

  test("393: More holds Reporting, Knowledge, Admin & health and Help", async ({ page }) => {
    await open(page, 393, "/?screen=home");
    await page.locator("nav.mc-tabs").getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet.locator(".grp-h")).toHaveText([
      "Reporting",
      "Knowledge",
      "Operations",
      "Sync and data",
      "Engineering",
      "Help",
      "Navigate",
      "Appearance",
    ]);
    await sheet.getByRole("link", { name: "Ask the Brain" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/screen=brain-ask/);
    await expect(page.locator("nav.mc-tabs").getByRole("button", { name: "More" })).toHaveClass(/\bon\b/);
  });

  // TASK-3844: the workspace label is the PLX app switcher.
  test("the PLX app switcher opens below its label, links each app, and closes on Esc", async ({ page }) => {
    await open(page, 1440, "/?screen=board");
    const toggle = page.locator(".mc-top").getByRole("button", { name: "PLX Engineering · PLX apps" });
    const panel = page.locator("#mc-apps-flyout");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const t = (await toggle.boundingBox())!;
    const f = (await panel.boundingBox())!;
    expect(Math.round(f.x)).toBe(Math.round(t.x));
    expect(f.y - (t.y + t.height)).toBeGreaterThanOrEqual(0);
    expect(f.y - (t.y + t.height)).toBeLessThanOrEqual(8);
    const apps = panel.getByRole("link");
    await expect(apps).toHaveText([/^Mission Control/, /^MRP Suite/, /^Admin portal/, /^Customer portal/]);
    await expect(apps.first()).toHaveAttribute("aria-current", "true");
    await expect(apps.nth(1)).toHaveAttribute("href", "https://staging.plxcustomer.io/mrp");
    // It owns Esc, and focus goes back to its toggle.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    // Mission Control goes home and closes it.
    await toggle.click();
    await apps.first().click();
    await expect(panel).toBeHidden();
    await expect(side(page).getByRole("link", { name: /^Home\b/ })).toHaveAttribute("aria-current", "page");
  });

  test("820: the app switcher is the mark alone, and still opens", async ({ page }) => {
    await open(page, 820, "/?screen=board");
    const toggle = page.locator(".mc-top").getByRole("button", { name: "PLX Engineering · PLX apps" });
    await expect(toggle).toBeVisible();
    await expect(toggle.locator(".ws-name")).toBeHidden();
    const box = (await toggle.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(page.locator("#mc-apps-flyout").getByRole("link")).toHaveCount(4);
  });

  test("393: no app switcher in the phone's top bar", async ({ page }) => {
    await open(page, 393, "/?screen=board");
    await expect(page.locator(".mc-top").getByRole("button", { name: "PLX Engineering · PLX apps" })).toBeHidden();
  });


  // TASK-3841: initiatives sit under their project in a capped tree.
  test("the Projects tree opens a project's initiatives, and the Projects row lands on Projects", async ({ page }) => {
    await open(page, 1440, "/?screen=board");
    const nav = side(page);
    const tree = nav.getByRole("group", { name: "Projects", exact: true });
    const toggle = tree.getByRole("button", { name: "Initiatives in PLX Portal Go-Live" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(tree.getByRole("link", { name: "WMS Integration" })).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(tree.getByRole("link", { name: "WMS Integration" })).toBeVisible();
    // One fixture project: nothing is left out, so no View all row.
    await expect(tree.getByRole("link", { name: /^View all/ })).toHaveCount(0);
    await nav.getByRole("link", { name: "Projects", exact: true }).click();
    const screen = page.getByTestId("projects-screen");
    await expect(screen).toBeVisible();
    await expect(nav.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(screen.getByRole("link", { name: "PLX Portal Go-Live" })).toBeVisible();
    await screen.getByRole("link", { name: "UAT", exact: true }).click();
    await expect(page.getByTestId("bucket-kicker")).toContainText("Initiative · BKT-UAT");
    expect(await shellViolations(page)).toEqual([]);
  });

  // Review round 1: closing the current project keeps it shut on that screen,
  // and arriving on another of its initiatives opens it again.
  test("a project closed by hand opens again on arriving at one of its initiatives", async ({ page }) => {
    await open(page, 1440, "/?screen=project&projectId=PRJ-PORTAL-GOLIVE");
    const tree = side(page).getByRole("group", { name: "Projects", exact: true });
    const toggle = tree.getByRole("button", { name: "Initiatives in PLX Portal Go-Live" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.getByTestId("project-screen").locator(".pv-open").first().click();
    await expect(page.getByTestId("bucket-kicker")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(tree.locator('[aria-current="page"]')).toBeVisible();
  });

  test("deep links to the project and to every initiative open that screen, with its row lit", async ({ page }) => {
    await open(page, 1440, "/?screen=project&projectId=PRJ-PORTAL-GOLIVE");
    await expect(page.getByTestId("project-screen")).toBeVisible();
    await expect(side(page).getByRole("link", { name: "PLX Portal Go-Live" })).toHaveAttribute("aria-current", "page");
    for (const [id, name] of [
      ["BKT-WMS", "WMS Integration"],
      ["BKT-DAPI", "Decoupling API"],
      ["BKT-PROD", "Product Development"],
      ["BKT-FIN", "Finance"],
      ["BKT-QMS", "QMS"],
      ["BKT-SHOP", "Shopify → Business Central"],
      ["BKT-INFRA", "Backend Infra"],
      ["BKT-UAT", "UAT"],
    ]) {
      await open(page, 1440, `/?screen=bucket&bucketId=${id}`);
      await expect(page.getByTestId("bucket-kicker")).toContainText(`Initiative · ${id}`);
      const row = side(page).getByRole("link", { name, exact: true });
      await expect(row, id).toHaveAttribute("aria-current", "page");
      await expect(row, id).toBeVisible();
    }
  });

  // TASK-3955 — the v2 sidebar (portal ADR-011 v2 amendment).
  test("1440: one row grid: every label starts at one line, the action column ends at one line", async ({ page }) => {
    await open(page, 1440, "/?screen=bucket&bucketId=BKT-WMS");
    const nav = side(page);
    const left = async (row: ReturnType<Page["locator"]>) => Math.round((await row.locator(".nm").boundingBox())!.x);
    const rows = [
      nav.getByRole("link", { name: /^Home/ }),
      nav.getByRole("link", { name: "All work", exact: true }),
      nav.getByRole("link", { name: "Projects", exact: true }),
      nav.getByRole("link", { name: "PLX Portal Go-Live" }),
      nav.getByRole("link", { name: "WMS Integration" }),
      nav.getByRole("link", { name: /^Dashboard/ }),
      footToggle(page),
    ];
    const starts = await Promise.all(rows.map(left));
    expect(new Set(starts).size, `label starts ${starts.join(", ")}`).toBe(1);
    // The chevron sits in the icon column, the + and the › end the action column.
    const chevron = (await nav.getByRole("button", { name: "Initiatives in PLX Portal Go-Live" }).boundingBox())!;
    expect(chevron.x + chevron.width).toBeLessThanOrEqual(starts[0]);
    const plus = (await nav.getByRole("button", { name: "New project or initiative" }).boundingBox())!;
    const more = (await footToggle(page).locator(".act").boundingBox())!;
    expect(Math.round(plus.x + plus.width)).toBe(Math.round(more.x + more.width + 5));
    expect(await shellViolations(page)).toEqual([]);
  });

  test("the sidebar is one tab stop: arrows, → and ←, a letter, then Tab out and back", async ({ page }) => {
    await open(page, 1440, "/?screen=dashboard");
    const nav = side(page);
    const focused = (name: string | RegExp) => expect(nav.getByRole("link", { name })).toBeFocused();
    // Shift+Tab from the page lands on the current row: the tree's one stop.
    await page.locator("#mc-main").focus();
    await page.keyboard.press("Shift+Tab");
    await focused(/^Dashboard/);
    await page.keyboard.press("ArrowDown");
    await focused(/^Insights/);
    await page.keyboard.press("ArrowUp");
    await focused(/^Dashboard/);
    await page.keyboard.press("Home");
    await focused(/^Home/);
    await page.keyboard.press("End");
    await focused("Help and shortcuts");
    // A letter only jumps: g goes to Goals, and g b does not switch to Board.
    await page.keyboard.press("g");
    await focused(/^Goals & production/);
    await page.keyboard.press("b");
    await expect(page).toHaveURL(/screen=dashboard/);
    // p, p: Projects, then the project; → opens it, → enters, ← climbs, ← closes.
    await page.keyboard.press("p");
    await focused("Projects");
    await page.keyboard.press("p");
    await focused("PLX Portal Go-Live");
    const toggle = nav.getByRole("button", { name: "Initiatives in PLX Portal Go-Live" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight");
    await focused("WMS Integration");
    await page.keyboard.press("ArrowLeft");
    await focused("PLX Portal Go-Live");
    await page.keyboard.press("ArrowLeft");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Tab leaves the tree; Shift+Tab comes back to the same row.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("nav.mc-side"))).toBe(false);
    await page.keyboard.press("Shift+Tab");
    await focused("PLX Portal Go-Live");
    expect(await nav.locator('[data-tree-key][tabindex="0"]').count()).toBe(1);
  });

  test("/ focuses the Projects filter, which narrows the tree; ↓ enters it and Esc clears it", async ({ page }) => {
    await open(page, 1440, "/?screen=dashboard");
    const nav = side(page);
    const filter = nav.getByRole("searchbox", { name: "Filter projects and initiatives" });
    await page.locator("#mc-main").focus();
    await page.keyboard.press("/");
    await expect(filter).toBeFocused();
    await page.keyboard.type("wms");
    await expect(nav.getByRole("link", { name: "WMS Integration" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Decoupling API" })).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(nav.getByRole("link", { name: "PLX Portal Go-Live" })).toBeFocused();
    await filter.fill("nothing like this");
    await expect(nav.getByRole("status")).toHaveText("No project or initiative matches.");
    expect(await shellViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(filter).toHaveValue("");
    await expect(nav.getByRole("link", { name: "PLX Portal Go-Live" })).toBeVisible();
    // A page with its own filter keeps / for it.
    await open(page, 1440, "/?screen=board");
    await page.locator("#mc-main").focus();
    await page.keyboard.press("/");
    await expect(page.locator("[data-page-filter]")).toBeFocused();
  });

  test("the + on Projects opens New project or New initiative, by click or Shift+F10", async ({ page }) => {
    await open(page, 1440, "/?screen=dashboard");
    const nav = side(page);
    const menu = page.locator("#mc-nav-new-menu");
    await expect(nav.getByRole("button", { name: /^New (project|initiative)$/ })).toHaveCount(0);
    await nav.getByRole("button", { name: "New project or initiative" }).click();
    await expect(menu.getByRole("button")).toHaveText(["New project", "New initiative"]);
    expect(await shellViolations(page, ["#mc-nav-new-menu"])).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await nav.getByRole("link", { name: "Projects", exact: true }).focus();
    await page.keyboard.press("Shift+F10");
    await expect(menu.getByRole("button", { name: "New project" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Create a new project" })).toBeVisible();
  });
});
