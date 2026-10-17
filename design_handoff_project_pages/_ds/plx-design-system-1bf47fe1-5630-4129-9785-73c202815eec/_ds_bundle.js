/* @ds-bundle: {"format":4,"namespace":"PLXDesignSystem_1bf47f","components":[],"sourceHashes":{"canonical-reference/tokens.ts":"ce82aeb349b5","ui_kits/customer-portal/primitives.jsx":"86f7104f1115","ui_kits/customer-portal/screens.jsx":"5f0d8c166bb3","ui_kits/customer-portal/shell.jsx":"79bcf46ae227"},"inlinedExternals":[],"unexposedExports":[{"name":"cssVar","sourcePath":"canonical-reference/tokens.ts"},{"name":"darkTokens","sourcePath":"canonical-reference/tokens.ts"},{"name":"fonts","sourcePath":"canonical-reference/tokens.ts"},{"name":"icon","sourcePath":"canonical-reference/tokens.ts"},{"name":"layer","sourcePath":"canonical-reference/tokens.ts"},{"name":"layout","sourcePath":"canonical-reference/tokens.ts"},{"name":"lightTokens","sourcePath":"canonical-reference/tokens.ts"},{"name":"motion","sourcePath":"canonical-reference/tokens.ts"},{"name":"radius","sourcePath":"canonical-reference/tokens.ts"},{"name":"space","sourcePath":"canonical-reference/tokens.ts"},{"name":"textScale","sourcePath":"canonical-reference/tokens.ts"},{"name":"tokens","sourcePath":"canonical-reference/tokens.ts"},{"name":"tracking","sourcePath":"canonical-reference/tokens.ts"}]} */

(() => {

const __ds_ns = (window.PLXDesignSystem_1bf47f = window.PLXDesignSystem_1bf47f || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// canonical-reference/tokens.ts
try { (() => {
/**
 * PLX Design System — TypeScript token exports
 *
 * Mirror of tokens.css for build-time consumers (charts, generators,
 * agent prompts, type-safe component props). Values are kept in sync
 * with tokens.css by hand for v0; codegen can be added later if drift
 * becomes a problem.
 *
 * IMPORT PATH (after migration):
 *   import { tokens, lightTokens, darkTokens } from '@/design-system/tokens';
 *
 * SOURCE OF TRUTH: tokens.css. If you change a value here, change it
 * there too. Drift between the two is a hygiene violation.
 */

const lightTokens = {
  // surfaces
  paper: '#FBFAF6',
  paper2: '#ECEFE9',
  card: '#FBFAF6',
  rail: '#EEEBE3',
  canvas: '#F5F3EC',
  // text
  ink: '#1B1A17',
  ink2: '#3A3833',
  muted: '#6B665B',
  // hairlines
  grid: 'rgba(27, 26, 23, 0.16)',
  grid2: 'rgba(27, 26, 23, 0.08)',
  // brand
  accent: '#244A39',
  accentSoft: '#BCCFBF',
  // status
  ok: '#5C7A55',
  warn: '#C99340',
  info: '#5B7B91',
  hot: '#52606E',
  // status foreground shades (AA text on surfaces + 12% chip fills)
  okText: '#48603F',
  warnText: '#7E5C0F',
  infoText: '#476378',
  hotText: '#46535F',
  // scrim — drawer/sheet backdrop wash
  scrim: 'rgba(27, 26, 23, 0.5)'
};
const darkTokens = {
  paper: '#1A1816',
  paper2: '#22201D',
  card: '#1A1816',
  rail: '#16140F',
  canvas: '#1A1816',
  ink: '#F1ECE0',
  ink2: '#C9C2B5',
  muted: '#A09789',
  // AA on every dark surface (2026-08-12); was #827B6F
  grid: 'rgba(241, 236, 224, 0.12)',
  grid2: 'rgba(241, 236, 224, 0.06)',
  accent: '#7AB18C',
  accentSoft: '#264132',
  // darkened 2026-08-12 so --p-accent reads AA on it (was #2D4D3B)
  ok: '#7EA372',
  // lightened 2026-08-12 for AA on MRP dark paper-2 (was #7A9E6F)
  warn: '#D9A85C',
  info: '#7A9DB3',
  hot: '#8FA0B0',
  okText: 'var(--p-ok)',
  warnText: 'var(--p-warn)',
  infoText: 'var(--p-info)',
  hotText: 'var(--p-hot)',
  scrim: 'rgba(0, 0, 0, 0.6)'
};
const fonts = {
  serif: 'var(--font-mazius-display, "Mazius Display"), "Times New Roman", Georgia, serif',
  sans: 'var(--font-inter, "Inter"), "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  mono: 'var(--font-jetbrains-mono, "JetBrains Mono"), "IBM Plex Mono", ui-monospace, monospace'
};
const textScale = {
  display: '56px',
  h1: '32px',
  h2: '24px',
  h3: '18px',
  body: '14px',
  bodyCompact: '13px',
  small: '12px',
  mono: '11px',
  meta: '10px',
  kicker: '9.5px',
  tick: '9px'
};
const tracking = {
  tick: '0.22em',
  meta: '0.16em',
  data: '0.04em'
};
const radius = {
  sm: '3px',
  default: '4px',
  lg: '6px'
};
const space = {
  1: '4px',
  2: '8px',
  3: '14px',
  4: '22px',
  5: '32px',
  6: '48px',
  7: '72px'
};
const motion = {
  ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  durFast: '120ms',
  dur: '180ms',
  durSlow: '320ms'
};

/** Icon sizes — the two sizes brand surfaces use (Phase 5). */
const icon = {
  default: '16px',
  lg: '32px'
};

/** Layout constants for ticket-detail key/value field grids. */
const layout = {
  fieldLabelW: '160px'
};

/** Layering — chrome contract (drawer above backdrop; see CONTRIBUTING §2). */
const layer = {
  drawer: '60',
  scrim: '59'
};

/** CSS custom property names — useful when you need the var, not the value. */
const cssVar = {
  paper: 'var(--p-paper)',
  paper2: 'var(--p-paper-2)',
  card: 'var(--p-card)',
  ink: 'var(--p-ink)',
  ink2: 'var(--p-ink-2)',
  muted: 'var(--p-muted)',
  grid: 'var(--p-grid)',
  grid2: 'var(--p-grid-2)',
  accent: 'var(--p-accent)',
  accentSoft: 'var(--p-accent-soft)',
  ok: 'var(--p-ok)',
  warn: 'var(--p-warn)',
  info: 'var(--p-info)',
  hot: 'var(--p-hot)',
  fontSerif: 'var(--p-font-serif)',
  fontSans: 'var(--p-font-sans)',
  fontMono: 'var(--p-font-mono)'
};

/** Default export = light scheme values. */
const tokens = lightTokens;
Object.assign(__ds_scope, { lightTokens, darkTokens, fonts, textScale, tracking, radius, space, motion, icon, layout, layer, cssVar, tokens });
})(); } catch (e) { __ds_ns.__errors.push({ path: "canonical-reference/tokens.ts", error: String((e && e.message) || e) }); }

// ui_kits/customer-portal/primitives.jsx
try { (() => {
// PLX portal — shared primitives. Exported to window for cross-file Babel scope.
const {
  useState
} = React;

// Lucide icon by name → inline SVG via lucide global. Falls back to empty.
function Icon({
  name,
  className
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = "";
      const el = document.createElement("i");
      el.setAttribute("data-lucide", name);
      ref.current.appendChild(el);
      window.lucide.createIcons({
        icons: window.lucide.icons,
        nameAttr: "data-lucide",
        root: ref.current
      });
    }
  }, [name]);
  return React.createElement("span", {
    ref,
    className,
    style: {
      display: "inline-flex"
    }
  });
}
function Pill({
  kind = "acc",
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "pill " + kind
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), children);
}
function Btn({
  variant,
  children,
  onClick,
  icon
}) {
  const cls = "btn" + (variant ? " " + variant : "");
  return /*#__PURE__*/React.createElement("button", {
    className: cls,
    onClick: onClick
  }, icon ? /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    className: "i"
  }) : null, children);
}
function StatCard({
  label,
  value,
  icon
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, label), /*#__PURE__*/React.createElement(Icon, {
    name: icon
  })), /*#__PURE__*/React.createElement("span", {
    className: "val"
  }, value));
}
Object.assign(window, {
  Icon,
  Pill,
  Btn,
  StatCard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/customer-portal/primitives.jsx", error: String((e && e.message) || e) }); }

// ui_kits/customer-portal/screens.jsx
try { (() => {
// PLX portal — screen views. Depends on window.{Icon,Pill,Btn,StatCard}.
const {
  useState: useS
} = React;

/* ── DASHBOARD ─────────────────────────────────────────── */
const ONBOARD = [{
  label: "Account created",
  done: true
}, {
  label: "Company profile complete",
  done: true
}, {
  label: "First project created",
  done: true
}, {
  label: "Documents uploaded",
  done: false
}, {
  label: "Onboarding approved",
  done: false
}];
const ACTIVITY = [{
  t: "Stability protocol uploaded to Marula Balm",
  when: "2h ago"
}, {
  t: "FM-2041 moved to In Review",
  when: "Yesterday"
}, {
  t: "Warming Hand Cream brief approved",
  when: "2d ago"
}, {
  t: "Credit application submitted",
  when: "4d ago"
}];
function Dashboard({
  onNav
}) {
  const done = ONBOARD.filter(s => s.done).length;
  const pct = done / ONBOARD.length * 100;
  return /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "page-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Dashboard"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Welcome back, Mara \u2014 Verena Botanicals"))), /*#__PURE__*/React.createElement("div", {
    className: "stats"
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Projects",
    value: "3",
    icon: "folder-open"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Documents",
    value: "12",
    icon: "file-text"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Pending",
    value: "2",
    icon: "clock"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Approved",
    value: "8",
    icon: "check-circle-2"
  })), /*#__PURE__*/React.createElement("div", {
    className: "grid2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-h"
  }, "Onboarding Progress"), /*#__PURE__*/React.createElement("div", {
    className: "prog-track"
  }, /*#__PURE__*/React.createElement("div", {
    className: "prog-fill",
    style: {
      width: pct + "%"
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "sub",
    style: {
      marginTop: 10,
      fontSize: 12,
      color: "var(--p-muted)"
    }
  }, done, " of ", ONBOARD.length, " steps completed"), /*#__PURE__*/React.createElement("div", {
    className: "steps"
  }, ONBOARD.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.label,
    className: "step " + (s.done ? "done" : "todo")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s.done ? "check-circle-2" : "circle"
  }), /*#__PURE__*/React.createElement("span", null, s.label))))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-h"
  }, "Quick Actions"), /*#__PURE__*/React.createElement("div", {
    className: "qa"
  }, /*#__PURE__*/React.createElement("div", {
    className: "qa-btn",
    onClick: () => onNav("projects")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "folder-plus"
  }), /*#__PURE__*/React.createElement("span", null, "New project"), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    className: "arr"
  })), /*#__PURE__*/React.createElement("div", {
    className: "qa-btn",
    onClick: () => onNav("documents")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload"
  }), /*#__PURE__*/React.createElement("span", null, "Upload document"), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    className: "arr"
  })), /*#__PURE__*/React.createElement("div", {
    className: "qa-btn",
    onClick: () => onNav("credit")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "credit-card"
  }), /*#__PURE__*/React.createElement("span", null, "Start credit application"), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    className: "arr"
  })), /*#__PURE__*/React.createElement("div", {
    className: "qa-btn",
    onClick: () => onNav("approvals")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check-square"
  }), /*#__PURE__*/React.createElement("span", null, "Review approvals"), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    className: "arr"
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-h"
  }, "Recent Activity"), /*#__PURE__*/React.createElement("div", {
    className: "act"
  }, ACTIVITY.map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "act-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "act-dot"
  }), /*#__PURE__*/React.createElement("span", {
    className: "t"
  }, a.t), /*#__PURE__*/React.createElement("span", {
    className: "when"
  }, a.when))))));
}

/* ── PROJECTS ──────────────────────────────────────────── */
const PROJECTS = [{
  nm: "Marula Hand Balm",
  ty: "New Product Brief",
  st: "Active",
  pill: "acc",
  ds: "Solid balm stick, shea + marula base. Targeting Q3 launch.",
  docs: 6,
  fm: "FM-2041"
}, {
  nm: "Warming Hand Cream",
  ty: "Reformulation",
  st: "In review",
  pill: "warn",
  ds: "Reduced fragrance load; IFRA realignment in progress.",
  docs: 4,
  fm: "FM-1988"
}, {
  nm: "Botanical Lip Treatment",
  ty: "Tech Transfer",
  st: "Approved",
  pill: "ok",
  ds: "Transfer from pilot to production line 2.",
  docs: 9,
  fm: "FM-2105"
}, {
  nm: "Citrus Body Polish",
  ty: "New Product Brief",
  st: "Draft",
  pill: "info",
  ds: "Sugar-based exfoliant, early concept.",
  docs: 1,
  fm: "—"
}, {
  nm: "Repair Night Serum",
  ty: "Reformulation",
  st: "Active",
  pill: "acc",
  ds: "Peptide blend revision, stability testing underway.",
  docs: 7,
  fm: "FM-2077"
}, {
  nm: "Mineral Sun Stick",
  ty: "New Product Brief",
  st: "In review",
  pill: "warn",
  ds: "Non-nano zinc, SPF 30 claim support pending.",
  docs: 3,
  fm: "FM-2120"
}];
function Projects() {
  return /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "page-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Projects"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Manage your product briefs and tech transfers")), /*#__PURE__*/React.createElement(Btn, {
    variant: "acc",
    icon: "folder-plus"
  }, "New project")), /*#__PURE__*/React.createElement("div", {
    className: "proj-grid"
  }, PROJECTS.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.nm,
    className: "proj"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ph"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "nm"
  }, p.nm), /*#__PURE__*/React.createElement("div", {
    className: "ty"
  }, p.ty)), /*#__PURE__*/React.createElement(Pill, {
    kind: p.pill
  }, p.st)), /*#__PURE__*/React.createElement("div", {
    className: "ds"
  }, p.ds), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", null, p.docs, " documents"), /*#__PURE__*/React.createElement("span", null, p.fm))))));
}

/* ── DOCUMENTS ─────────────────────────────────────────── */
const DOCS = [{
  fn: "Marula-Balm-Stability-v2.pdf",
  ty: "Stability Data",
  pr: "Marula Hand Balm",
  st: "In review",
  pill: "warn",
  when: "2h ago",
  fm: "FM-2041",
  attn: false
}, {
  fn: "Warming-Cream-IFRA-Cert.pdf",
  ty: "Regulatory",
  pr: "Warming Hand Cream",
  st: "Revision needed",
  pill: "warn",
  when: "1d ago",
  fm: "FM-1988",
  attn: true,
  fb: "Allergen 26 declaration missing — please re-export."
}, {
  fn: "Lip-Treatment-Spec-Sheet.pdf",
  ty: "Specification",
  pr: "Botanical Lip Treatment",
  st: "Approved",
  pill: "ok",
  when: "3d ago",
  fm: "FM-2105",
  attn: false
}, {
  fn: "Verena-MSA-2025.pdf",
  ty: "Contract",
  pr: "General",
  st: "Approved",
  pill: "ok",
  when: "5d ago",
  fm: "—",
  attn: false
}, {
  fn: "Serum-Peptide-COA.pdf",
  ty: "Raw Material",
  pr: "Repair Night Serum",
  st: "Pending",
  pill: "info",
  when: "6d ago",
  fm: "FM-2077",
  attn: false
}];
function Documents() {
  const needs = DOCS.filter(d => d.attn).length;
  return /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "page-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Documents"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "View and manage your uploaded documents")), /*#__PURE__*/React.createElement(Btn, {
    variant: "acc",
    icon: "upload"
  }, "Upload document")), /*#__PURE__*/React.createElement("div", {
    className: "stats"
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Total",
    value: "12",
    icon: "file-text"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "In review",
    value: "2",
    icon: "clock"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Approved",
    value: "8",
    icon: "check-circle-2"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Needs action",
    value: "1",
    icon: "alert-circle"
  })), needs > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "attn-bar"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "rotate-ccw"
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, needs), " document needs your attention \u2014 please review feedback and re-upload if needed.")) : null, /*#__PURE__*/React.createElement("div", {
    className: "tbl-card"
  }, /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "File name"), /*#__PURE__*/React.createElement("th", null, "Type"), /*#__PURE__*/React.createElement("th", null, "Project"), /*#__PURE__*/React.createElement("th", null, "Status"), /*#__PURE__*/React.createElement("th", null, "Uploaded"), /*#__PURE__*/React.createElement("th", null, "FM Ref"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, DOCS.map(d => /*#__PURE__*/React.createElement("tr", {
    key: d.fn,
    className: d.attn ? "attn" : ""
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
    className: "file"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text"
  }), /*#__PURE__*/React.createElement("a", null, d.fn)), d.attn ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--mono)",
      fontSize: 10,
      color: "var(--p-warn)",
      marginTop: 5,
      paddingLeft: 24
    }
  }, "Feedback: ", d.fb) : null), /*#__PURE__*/React.createElement("td", null, d.ty), /*#__PURE__*/React.createElement("td", null, d.pr), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Pill, {
    kind: d.pill
  }, d.st)), /*#__PURE__*/React.createElement("td", {
    className: "fm"
  }, d.when), /*#__PURE__*/React.createElement("td", {
    className: "fm"
  }, d.fm), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--mono)",
      fontSize: 10,
      letterSpacing: ".1em",
      textTransform: "uppercase",
      color: "var(--p-accent)",
      cursor: "pointer"
    }
  }, "View"))))))));
}

/* ── APPROVALS ─────────────────────────────────────────── */
const APPROVALS_INIT = [{
  id: 1,
  nm: "Marula Hand Balm — final formulation",
  det: "FM-2041 · submitted by PLX R&D · 2h ago",
  state: null
}, {
  id: 2,
  nm: "Warming Hand Cream — revised label artwork",
  det: "FM-1988 · submitted by PLX Packaging · 1d ago",
  state: null
}];
function Approvals() {
  const [items, setItems] = useS(APPROVALS_INIT);
  const set = (id, state) => setItems(xs => xs.map(x => x.id === id ? {
    ...x,
    state
  } : x));
  const pending = items.filter(x => !x.state).length;
  return /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "page-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Approvals"), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Sign off on items waiting for your review"))), pending > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "attn-bar"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check-square"
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, pending), " item", pending !== 1 ? "s" : "", " awaiting your sign-off.")) : null, /*#__PURE__*/React.createElement("div", {
    className: "appr"
  }, items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    className: "appr-row" + (it.state ? " resolved" : "")
  }, /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nm"
  }, it.nm), /*#__PURE__*/React.createElement("div", {
    className: "det"
  }, it.det)), it.state ? /*#__PURE__*/React.createElement(Pill, {
    kind: it.state === "approved" ? "ok" : "warn"
  }, it.state === "approved" ? "Approved" : "Changes requested") : /*#__PURE__*/React.createElement("div", {
    className: "acts"
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    onClick: () => set(it.id, "changes")
  }, "Request changes"), /*#__PURE__*/React.createElement(Btn, {
    variant: "acc",
    onClick: () => set(it.id, "approved")
  }, "Approve"))))));
}

/* ── PLACEHOLDER (forms / credit / notifications / account) ── */
function Placeholder({
  title,
  sub,
  icon
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "page-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, title), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, sub))), /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon
  }), /*#__PURE__*/React.createElement("h3", null, "Part of the full portal"), /*#__PURE__*/React.createElement("p", null, "This section exists in the live PLX customer portal. It is intentionally left as a stub in this UI kit \u2014 extend it from the kit primitives when you need it.")));
}
Object.assign(window, {
  Dashboard,
  Projects,
  Documents,
  Approvals,
  Placeholder
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/customer-portal/screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/customer-portal/shell.jsx
try { (() => {
// PLX portal — Sidebar + Header shell. Depends on window.Icon.
const {
  useState: useStateShell
} = React;
const NAV = [{
  key: "dashboard",
  name: "Dashboard",
  icon: "layout-dashboard"
}, {
  key: "projects",
  name: "Projects",
  icon: "folder-open"
}, {
  key: "documents",
  name: "Documents",
  icon: "file-text"
}, {
  key: "forms",
  name: "Forms & Contracts",
  icon: "clipboard-list"
}, {
  key: "approvals",
  name: "Approvals",
  icon: "check-square",
  count: 2
}, {
  key: "credit",
  name: "Credit Application",
  icon: "credit-card"
}, {
  key: "notifications",
  name: "Notifications",
  icon: "bell",
  count: 3
}, {
  key: "account",
  name: "Account",
  icon: "settings"
}];
const CRUMB = {
  dashboard: "Portal / Dashboard",
  projects: "Portal / Projects",
  documents: "Portal / Documents",
  forms: "Portal / Forms & Contracts",
  approvals: "Portal / Approvals",
  credit: "Portal / Credit Application",
  notifications: "Portal / Notifications",
  account: "Portal / Account"
};
function Sidebar({
  active,
  onNav
}) {
  return /*#__PURE__*/React.createElement("aside", {
    className: "side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "side-brand"
  }, /*#__PURE__*/React.createElement("img", {
    className: "mk",
    src: "../../assets/logo-mark.svg",
    alt: "PLX"
  }), /*#__PURE__*/React.createElement("span", {
    className: "wm"
  }, "Customer Portal")), /*#__PURE__*/React.createElement("nav", {
    className: "side-nav"
  }, NAV.map(item => /*#__PURE__*/React.createElement("div", {
    key: item.key,
    className: "nav-item" + (active === item.key ? " active" : ""),
    onClick: () => onNav(item.key)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: item.icon
  }), /*#__PURE__*/React.createElement("span", null, item.name), item.count ? /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, item.count) : null))), /*#__PURE__*/React.createElement("div", {
    className: "side-foot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "blk"
  }, /*#__PURE__*/React.createElement("div", {
    className: "k"
  }, "PLX Personal Care"), /*#__PURE__*/React.createElement("div", {
    className: "v"
  }, "Contract Manufacturing"))));
}
function Header({
  active
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "crumb"
  }, CRUMB[active]), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    className: "ic"
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    className: "ic"
  }), /*#__PURE__*/React.createElement("div", {
    className: "avatar"
  }, "MV"));
}
Object.assign(window, {
  Sidebar,
  Header,
  NAV
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/customer-portal/shell.jsx", error: String((e && e.message) || e) }); }

})();
