import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

// Shared E2E helpers for the Mission Control Cycle-1 specs. Kept tiny and
// deterministic — web-first assertions only, no arbitrary sleeps.

// The app boots at route "home" (the Inbox). Navigate to a Views screen by its
// sidebar entry, then wait for the views toolbar ("Group by") to confirm the
// WorkViews surface mounted. Reused by every spec that needs the board/list.
export async function gotoBoard(page: Page): Promise<void> {
  await page.goto("/");
  await waitForHydration(page);
  await openSidebar(page, "Board");
  await expect(page.getByText("Group by")).toBeVisible();
}

// Wait for client hydration before driving React-state navigation or keyboard
// shortcuts. The shell sets data-mc-ready ONLY from a post-mount effect, after
// its global keydown listener is attached — so this marks true interactivity.
// The previous anchor (the sync-pill label) is server-rendered and already
// present in the SSR HTML, so it resolved immediately and raced the ⌘K handler
// under load (page.keyboard.press has no actionability delay, unlike .click()).
// See LESSONS 2026-06-17.
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator("[data-mc-ready='true']")).toBeAttached();
}

export async function openSidebar(page: Page, label: string): Promise<void> {
  // Sidebar items are <button> with a ".nm" label span; scope to the nav so we
  // never match a same-named control elsewhere (e.g. the "Board" view tab).
  await page.locator("nav.mc-side button", { hasText: label }).first().click();
}

// The board renders one ".bcol" per column; the header ".bhead .nm" carries the
// column name and ".bhead .ct" the live count. Cards are ".tcard" buttons.
export function boardColumns(page: Page): Locator {
  return page.locator(".mc .board .bcol");
}

// A board column located by its visible header name. Plain-string `hasText` is
// a normalized substring match, so "Planned" matches the stage header "04
// Planned" and "In QA" matches "06 In QA  Evidence gate" — the names are unique
// per axis, so a substring match is unambiguous.
export function boardColumnByName(page: Page, name: string): Locator {
  return page
    .locator(".mc .board .bcol")
    .filter({ has: page.locator(".bhead .nm", { hasText: name }) });
}

export function cardById(page: Page, taskId: string): Locator {
  // Each card shows its id in ".ct-id"; filter the card buttons by it.
  return page.locator(".mc .tcard", {
    has: page.locator(".ct-id", { hasText: new RegExp(`^${escapeRe(taskId)}$`) }),
  });
}

// Pick the Group-by axis via the toolbar segment (reuses the .seg skin). The
// first .seg is the Group-by segment (Swimlanes is a second, conditional .seg).
export async function setGroupBy(page: Page, label: string): Promise<void> {
  await page
    .locator(".tb .seg")
    .first()
    .locator("button", { hasText: new RegExp(`^${escapeRe(label)}$`) })
    .click();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Native HTML5 drag-and-drop simulation ────────────────────────────────────
// Playwright's built-in dragTo() does not reliably carry a populated
// dataTransfer across the synthetic drag events, and the board reads a CUSTOM
// MIME ("application/x-mc-task"). So we dispatch dragstart → dragover → drop
// ourselves with ONE shared DataTransfer instance, exactly as a real browser
// would — the card's onDragStart writes the id, the target column's onDrop reads
// it back and calls the matching store mutation. Deterministic (no timing
// race); exercises the real handlers, not a shortcut around them.
//
// The card is located by its ".ct-id" text and the destination column by its
// visible header name — dropping on that exact ".bbody" DOM node triggers the
// per-column React onDrop bound with that column's real key.
export async function dragCardToColumnByName(
  page: Page,
  cardId: string,
  columnName: string
): Promise<void> {
  await page.evaluate(
    ({ cardText, colName }) => {
      const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".mc .tcard"));
      const card = cards.find((el) => norm(el.querySelector(".ct-id")?.textContent) === cardText);
      if (!card) throw new Error(`drag: card ${cardText} not found`);

      const cols = Array.from(document.querySelectorAll<HTMLElement>(".mc .board .bcol"));
      // Match the column whose header name CONTAINS the requested name (stage
      // headers also carry an "NN" number + optional "gate" chip, so exact-eq
      // would miss them; the names are unique per axis, so contains is safe).
      const targetCol = cols.find((col) => norm(col.querySelector(".bhead .nm")?.textContent).includes(colName));
      const body = targetCol?.querySelector<HTMLElement>(".bbody");
      if (!body) throw new Error(`drag: column "${colName}" not found`);

      const dt = new DataTransfer();
      const fire = (type: string, target: HTMLElement) => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
        target.dispatchEvent(ev);
      };
      fire("dragstart", card);
      fire("dragover", body);
      fire("drop", body);
      fire("dragend", card);
    },
    { cardText: cardId, colName: columnName }
  );
}
