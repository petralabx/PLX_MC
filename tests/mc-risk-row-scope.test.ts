// TASK-3333 — the Risk Register row rule was a bare `.mc .risk`, so every
// element whose health class is `risk` took its two-column grid: an At risk
// initiative on the project page drew its task table 0px wide and looked blank,
// and the initiative cards, sidebar health dots, file markers and timeline
// milestones picked up its padding and border. A bare `.risk` row rule must stay
// inside its lists (`.mlist`, `.risks`); a health modifier (`.pv-sec.risk`)
// sits on its own component and is not a row.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

type Source = { file: string; text: string };

const ROW_SCOPE = ":is(.mlist, .risks) > .risk";

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

// A selector list split on its top-level commas (not the ones inside `:is(…)`).
function splitSelectors(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    if (prelude[i] === "(") depth++;
    else if (prelude[i] === ")") depth--;
    else if (prelude[i] === "," && depth === 0) {
      parts.push(prelude.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(prelude.slice(start));
  return parts.map((s) => s.replace(/\s+/g, " ").trim());
}

// Every selector with a compound that starts with `.risk` (a row, not a health
// modifier on another class) and is not scoped to the Risk Register lists.
function unscopedRiskRowSelectors(sources: Source[]): string[] {
  const found: string[] = [];
  for (const { file, text } of sources) {
    for (const [prelude] of stripComments(text).matchAll(/[^{}]+(?=\{)/g)) {
      if (prelude.trim().startsWith("@")) continue;
      for (const selector of splitSelectors(prelude)) {
        if (/(^|[\s>+~])\.risk(?![\w-])/.test(selector) && !selector.includes(ROW_SCOPE)) {
          found.push(`${file}: ${selector}`);
        }
      }
    }
  }
  return found;
}

const SRC = join(import.meta.dirname, "..", "src");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const stylesheets = (): Source[] =>
  walk(SRC)
    .filter((path) => path.endsWith(".css"))
    .map((path) => ({ file: relative(SRC, path), text: readFileSync(path, "utf8") }));

describe("unscopedRiskRowSelectors", () => {
  it("flags the bare row rule that blanked At risk initiatives", () => {
    const css = ".mc .risk {\n  display: grid;\n}\n.mc .risk .t,\n.mc .x { color: red; }";
    expect(unscopedRiskRowSelectors([{ file: "styles/a.css", text: css }])).toEqual([
      "styles/a.css: .mc .risk",
      "styles/a.css: .mc .risk .t",
    ]);
  });

  it("allows scoped rows and health modifiers on their own component", () => {
    const css =
      ".mc :is(.mlist, .risks) > .risk { display: grid; }\n" +
      ".mc :is(.mlist, .risks) > .risk.milestone { gap: 0; }\n" +
      ".mc .pv-sec.risk, .mc .init-card.risk, .mc .hl.risk::before { color: orange; }\n" +
      "@container pv-tt (max-width: 599px) { .mc .risks-note { color: red; } }";
    expect(unscopedRiskRowSelectors([{ file: "styles/b.css", text: css }])).toEqual([]);
  });

  it("finds no unscoped Risk Register row rule in src", () => {
    expect(unscopedRiskRowSelectors(stylesheets())).toEqual([]);
  });
});
