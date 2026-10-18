// TASK-3176 follow-up — a custom property read without a fallback must be
// defined somewhere. #356's follow-up removed --mc-gutter-base from
// mc-shell.css while mc-initiative.css (#358) still read it: both declarations
// went invalid and the initiative strip and body lost their gutter at every
// width. This guard fails on that class of merge.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

type Source = { file: string; text: string };

// Set at runtime, not in any stylesheet. Add a token here only with its setter.
const RUNTIME_TOKENS = new Set([
  "--font-inter", // next/font `variable` in src/app/layout.tsx
  "--font-jetbrains-mono", // next/font `variable` in src/app/layout.tsx
  "--arc-dash", // inline style in src/components/mc/charts/donut.tsx
]);

// Undefined before this task and out of its scope; flagged for cleanup, not
// fixed here. Never add a new entry: define the token or give it a fallback.
const KNOWN_UNDEFINED = new Set([
  "--p-track-kicker", // src/styles/mc-architecture.css — no such brand token
]);

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

// Every var(--name) with no fallback whose --name is never declared in a
// stylesheet (`--name:` or `@property --name`) and is not set at runtime.
function undefinedVarRefs(sources: Source[], allowed: Set<string> = RUNTIME_TOKENS) {
  const defined = new Set(allowed);
  for (const { file, text } of sources) {
    if (!file.endsWith(".css")) continue;
    const body = stripComments(text);
    for (const m of body.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
    for (const m of body.matchAll(/@property\s+(--[\w-]+)/g)) defined.add(m[1]);
  }
  const missing: string[] = [];
  for (const { file, text } of sources) {
    for (const m of stripComments(text).matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      if (!defined.has(m[1])) missing.push(`${file}: ${m[1]}`);
    }
  }
  return missing;
}

const SRC = join(import.meta.dirname, "..", "src");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const tree = (): Source[] =>
  walk(SRC)
    .filter((path) => /\.(css|tsx)$/.test(path))
    .map((path) => ({ file: relative(SRC, path), text: readFileSync(path, "utf8") }));

describe("undefinedVarRefs", () => {
  it("flags the broken #356 follow-up × #358 merge", () => {
    const shell = {
      file: "styles/mc-shell.css",
      text: `@property --mc-col-gutter { syntax: "<length>"; inherits: true; initial-value: 0px; }
        .mc .mc-stage > * { --mc-col-gutter: max(var(--p-gutter), 1px); --mc-page-edge: var(--mc-col-gutter); }`,
    };
    const surface = { file: "styles/mc-surface.css", text: ".mc { --p-gutter: 26px; }" };
    const initiative = {
      file: "styles/mc-initiative.css",
      text: `.mc .ini-page .ini-body {
        padding-inline: calc(var(--mc-col-gutter) - var(--mc-gutter-base));
        --p-gutter: var(--mc-gutter-base);
      }`,
    };
    expect(undefinedVarRefs([shell, surface, initiative])).toEqual([
      "styles/mc-initiative.css: --mc-gutter-base",
      "styles/mc-initiative.css: --mc-gutter-base",
    ]);
    // Defining the token again (the pre-follow-up shell) clears it.
    const oldShell = { ...shell, text: `${shell.text} .mc .mc-stage { --mc-gutter-base: var(--p-gutter); }` };
    expect(undefinedVarRefs([oldShell, surface, initiative])).toEqual([]);
  });

  it("accepts a fallback, @property, a runtime token and inline TSX strings", () => {
    const sources = [
      { file: "a.css", text: "@property --reg { syntax: '<length>'; inherits: true; initial-value: 0px; }" },
      { file: "b.css", text: ".x { padding: var(--mc-page-edge, var(--p-gutter)); width: var(--reg); }" },
      { file: "c.tsx", text: 'const s = { width: "var(--arc-dash)", height: "var(--nope)" };' },
    ];
    // --p-gutter (no fallback, inside the fallback) is undefined here too.
    expect(undefinedVarRefs(sources)).toEqual(["b.css: --p-gutter", "c.tsx: --nope"]);
  });

  it("ignores references inside comments", () => {
    expect(undefinedVarRefs([{ file: "a.css", text: "/* var(--gone) */ .x { color: red; }" }])).toEqual([]);
  });
});

describe("custom properties under src/", () => {
  it("reads no undefined token without a fallback", () => {
    const missing = undefinedVarRefs(tree(), new Set([...RUNTIME_TOKENS, ...KNOWN_UNDEFINED]));
    expect(missing).toEqual([]);
  });

  it("keeps each runtime and known-undefined entry live", () => {
    // A stale entry would hide the next real miss under the same name.
    const sources = tree();
    const all = stripComments(sources.map((s) => s.text).join("\n"));
    for (const token of [...RUNTIME_TOKENS, ...KNOWN_UNDEFINED]) expect(all, token).toContain(token);
    const stillUndefined = undefinedVarRefs(sources);
    for (const token of KNOWN_UNDEFINED) expect(stillUndefined.join("\n"), token).toContain(token);
  });
});
