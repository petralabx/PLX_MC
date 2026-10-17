// TASK-3176 — pages tier by <main>'s own width, not the viewport, so opening
// the nav, pane or live column re-tiers the page (design handoff, Shell).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contentTier } from "@/components/mc/shell-prefs";

describe("contentTier", () => {
  it("puts each boundary width in the handoff's tier", () => {
    expect(contentTier(0)).toBe("phone");
    expect(contentTier(640)).toBe("phone");
    expect(contentTier(641)).toBe("tablet");
    expect(contentTier(1024)).toBe("tablet");
    expect(contentTier(1025)).toBe("desktop");
    expect(contentTier(1799)).toBe("desktop");
    expect(contentTier(1800)).toBe("ultra");
  });

  it("re-tiers the same viewport when the side nav takes room", () => {
    // 1200px viewport: rail closed vs the 240px sidebar beside main.
    expect(contentTier(1200)).toBe("desktop");
    expect(contentTier(1200 - 240)).toBe("tablet");
  });

  it("treats sub-pixel widths by their side of the boundary", () => {
    expect(contentTier(640.5)).toBe("tablet");
    expect(contentTier(1799.5)).toBe("desktop");
  });
});

// Sol P2 on #356: the ultra-wide centring inset is its own token
// (--mc-page-edge) on page edges only. --p-gutter keeps its small value, so
// dialogs, popovers and capped bodies (Help) stay usable at 3440 × 1440.
describe("ultra-wide page edge (CSS)", () => {
  const styles = join(import.meta.dirname, "..", "src/styles");
  const css = (file: string) => readFileSync(join(styles, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const GUTTER = 26; // --p-gutter's clamp() ceiling, reached from ~916px of viewport.
  const VIEWPORT_H = 1440;

  // Every block for a selector, merged in source order.
  const blocks = (sheet: string, selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
    return [...sheet.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join(";");
  };
  const rule = (sheet: string, selector: string) => {
    const body = blocks(sheet, selector);
    if (!body) throw new Error(`no rule ${selector}`);
    return body;
  };
  const decl = (body: string, prop: string) => new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();
  const customProps = (body: string) => [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]);

  // Substitutes var() (innermost first, so fallbacks nest), cqi and dvh.
  const resolve = (value: string, vars: Record<string, number>, mainWidth: number) => {
    let out = value.replace(/100cqi/g, `${mainWidth}px`).replace(/100dvh/g, `${VIEWPORT_H}px`);
    for (let m; (m = /var\((--[\w-]+)(?:,\s*([^()]*))?\)/.exec(out)); ) {
      const sub = m[1] in vars ? `${vars[m[1]]}px` : m[2];
      if (sub === undefined) throw new Error(`unresolved ${m[1]}`);
      out = out.replace(m[0], sub);
    }
    return out;
  };
  const px = (value: string, vars: Record<string, number>, mainWidth: number) => {
    const expr = resolve(value, vars, mainWidth)
      .replace(/(\d+(?:\.\d+)?)px/g, "$1")
      .replace(/calc\(/g, "(")
      .replace(/\b(max|min)\(/g, "Math.$1(");
    expect(expr).toMatch(/^[\d\s.+\-*/(),]*(Math\.(max|min)[\d\s.+\-*/(),]*)*$/);
    return Number(new Function(`return ${expr}`)());
  };
  const inlinePadding = (value: string, vars: Record<string, number>, mainWidth: number) => {
    const parts = resolve(value, vars, mainWidth).split(/\s+/);
    return px(parts[1] ?? parts[0], vars, mainWidth);
  };

  // Custom properties a screen subtree inside <main> sees, cascading the
  // shell's .mc-stage and .mc-stage > * rules over the surface gutter.
  const stageVars = (mainWidth: number) => {
    const shell = css("mc-shell.css");
    const vars: Record<string, number> = { "--p-gutter": GUTTER };
    for (const selector of [".mc .mc-stage", ".mc .mc-stage > *"]) {
      for (const [name, value] of customProps(blocks(shell, selector))) vars[name] = px(value, vars, mainWidth);
    }
    return vars;
  };

  it("never redefines --p-gutter outside the surface tokens", () => {
    for (const file of readdirSync(styles).filter((f) => f.endsWith(".css") && f !== "mc-surface.css")) {
      expect(css(file), file).not.toMatch(/--p-gutter\s*:/);
    }
  });

  it("carries the centring inset on --mc-page-edge and keeps the 1560px column", () => {
    const ultra = stageVars(3440);
    expect(ultra["--p-gutter"]).toBe(GUTTER);
    expect(ultra["--mc-page-edge"]).toBe((3440 - 1560) / 2);
    const header = inlinePadding(decl(rule(css("mc-app.css"), ".mc .ph"), "padding")!, ultra, 3440);
    expect(3440 - 2 * header).toBe(1560);
    // Desktop and the ultra boundary: the page edge is the plain gutter.
    for (const width of [1200, 1612]) expect(stageVars(width)["--mc-page-edge"]).toBe(GUTTER);
  });

  it("keeps the Goals dialog height at the normal gutter at 3440 × 1440", () => {
    const body = rule(css("mc-goals.css"), ".mc .goals .gp-dialog");
    const maxHeight = px(decl(body, "max-height")!, stageVars(3440), 3440);
    expect(maxHeight).toBe(VIEWPORT_H - 2 * GUTTER);
  });

  it("keeps Help's 880px body usable and aligned with the page header at 3440", () => {
    const ultra = stageVars(3440);
    const help = rule(css("mc-app.css"), ".mc .help");
    const padding = inlinePadding(decl(help, "padding")!, ultra, 3440);
    // border-box (globals.css): the 880px cap includes the padding.
    expect(px(decl(help, "max-width")!, ultra, 3440) - 2 * padding).toBe(880 - 2 * GUTTER);
    const shift = px(decl(help, "margin-inline-start") ?? "0px", ultra, 3440);
    expect(shift + padding).toBe(ultra["--mc-page-edge"]);
    // Capped bodies do not move below the ultra-wide column.
    for (const [file, selector] of [
      ["mc-app.css", ".mc .help"],
      ["mc-app.css", ".mc .inbox"],
      ["mc-overview.css", ".mc .feed"],
    ]) {
      const margin = decl(rule(css(file), selector), "margin-inline-start")!;
      expect(px(margin, stageVars(1200), 1200), selector).toBe(0);
      expect(px(margin, ultra, 3440), selector).toBe(ultra["--mc-page-edge"] - GUTTER);
    }
  });
});
