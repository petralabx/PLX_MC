// Sample data for the Mission Control project / initiative pages.
// Content mirrors the PLX Portal Go-Live project screenshots; counts on
// buckets are the real rollups (rows below are a sample of each table).
(function () {
  const actors = {
    va: { id: "va", name: "Vince Alton", init: "VA", kind: "human", role: "Engineering lead" },
    mo: { id: "mo", name: "Mara Okafor", init: "MO", kind: "human", role: "Finance ops" },
    ak: { id: "ak", name: "Arun Kapoor", init: "AK", kind: "human", role: "QMS" },
    cx: { id: "cx", name: "Cursor agent", init: "CX", kind: "agent", model: "gpt-5" },
    cl: { id: "cl", name: "Claude agent", init: "CL", kind: "agent", model: "opus" },
  };

  const STAGES = {
    backlog: { name: "Backlog", tone: "muted", band: "todo" },
    spec: { name: "Spec", tone: "info", band: "todo" },
    build: { name: "In progress", tone: "acc", band: "doing" },
    qa: { name: "QA", tone: "warn", band: "doing" },
    merged: { name: "Merged", tone: "ok", band: "done" },
    cancelled: { name: "Cancelled", tone: "muted", band: "cancelled" },
  };

  const PRIORITY = {
    urgent: { label: "Urgent", cls: "hot", tick: "▰▰▰▰", n: 4 },
    high: { label: "High", cls: "warn", tick: "▰▰▰▱", n: 3 },
    medium: { label: "Medium", cls: "info", tick: "▰▰▱▱", n: 2 },
    low: { label: "Low", cls: "muted", tick: "▰▱▱▱", n: 1 },
  };

  const t = (id, title, stage, pri, assignee, due, blocked, human) => ({
    id, title, stage, pri, assignee: assignee || null, due: due || "—", blocked: !!blocked, human: human || null,
  });

  const buckets = [
    {
      id: "BKT-WMS", name: "WMS Integration", health: "track", owner: "va", target: "Nov 20", started: "Jun 12",
      desc: "Pick queue, shipments and finished-goods posting from the portal into Business Central.",
      closed: 118, total: 122, done: 108, cancelled: 10,
      prd: { label: "wms-uom-genealogy-decision.md", href: "#", type: "md" },
      repos: ["plx-customer-portal", "plx-wms-sync"],
      tasks: [
        t("TASK-1014", "Fix Orders crash + unified FileMaker+Portal list (MRP-M-142)", "merged", "high"),
        t("TASK-1017", "WMS Pick Queue — terminal-status leak fix + status/date filters, sort, row-cap honesty (MRP-M-145)", "merged", "high"),
        t("TASK-1019", "WMS Pick Queue — Assembly \"Qty\" sort returns 500 (regression from MRP-M-145)", "merged", "high"),
        t("TASK-1020", "Project Development drawer fails its own 44px tap-target gate — blocks any PR touching PD paths", "merged", "high"),
        t("TASK-1021", "npm run typecheck OOMs — bump tsc heap to 8 GB to match build", "merged", "medium"),
        t("TASK-1030", "DIST O2C: order location default + skip ship-release", "merged", "high"),
        t("TASK-1036", "Pick queue: distinguish \"no components\" from \"readiness failed\" and stop offering Create Pick List on unpickable AOs (MRP-M-152)", "merged", "medium"),
        t("TASK-1037", "DIST: list filters + Sage pick-list bins", "merged", "high"),
        t("TASK-1041", "DIST: order/shipment location on document header (not Site dropdown)", "merged", "high"),
        t("TASK-1043", "DIST: Create shipment/pick list false missing-id toast", "merged", "high"),
        t("TASK-1079", "Fix BC pick slip generation — no pack mix, batch-specific lines (WMS UAT P0)", "merged", "urgent"),
        t("TASK-1080", "AO pick-requested / staging-requested workflow (WMS UAT P1)", "cancelled", "high"),
        t("TASK-1081", "Fix finished-goods posting and visibility after AO realize (WMS UAT P3)", "merged", "high"),
        t("TASK-1082", "Inventory overview: warehouses/bins/totals + ownership flag (WMS UAT P2)", "merged", "high"),
        t("TASK-1083", "Orders ready-to-ship view + shipment-release instructions (WMS UAT P4)", "merged", "medium"),
        t("TASK-1084", "Packaging UOM cases vs eaches (P0445) + BC pick-slip role gate (WMS UAT P5)", "merged", "high"),
        t("TASK-2791", "Genealogy: lot → pallet → shipment trace in the WMS detail drawer", "build", "high", "cx", "Oct 24"),
        t("TASK-2802", "UOM conversion table seeded from BC item cards (nightly)", "qa", "medium", "va", "Oct 21", false, "verify"),
        t("TASK-2810", "Pick-list print: paper-saving layout for 40+ line orders", "backlog", "low"),
        t("TASK-2811", "Staging-area capacity warning on AO release", "backlog", "medium", null, "Nov 02", true),
      ],
    },
    {
      id: "BKT-DECOUPLING-API", name: "Decoupling API", health: "track", owner: "va", target: "Sep 15", started: "Jul 03",
      desc: "Split the portal read-models from FileMaker so BC can become the system of record.",
      closed: 41, total: 47, done: 39, cancelled: 2,
      prd: null, repos: ["plx-customer-portal"],
      tasks: [
        t("TASK-1902", "Read-model contract for Orders v2 (OpenAPI + fixtures)", "merged", "high", "va"),
        t("TASK-1910", "Retire FileMaker ODBC bridge for order lookups", "merged", "high"),
        t("TASK-1931", "Shadow-read: diff portal vs BC order totals for 14 days", "qa", "medium", "cl", "Oct 20", false, "verify"),
        t("TASK-1944", "Cut-over switch + rollback flag (feature-gated)", "build", "urgent", "va", "Oct 23"),
        t("TASK-1952", "Document the decoupled architecture (C4 container view)", "backlog", "low"),
      ],
    },
    {
      id: "BKT-PRODUCT-DEV", name: "Product Development", health: "track", owner: "ak", target: "Aug 30", started: "May 20",
      desc: "Product briefs, tech transfers and formulation approvals in the customer portal.",
      closed: 212, total: 230, done: 190, cancelled: 22,
      prd: { label: "SPEC.md", href: "#", type: "md" }, repos: ["plx-customer-portal"],
      tasks: [
        t("TASK-2201", "Brief → formulation hand-off: required fields and approval gate", "merged", "high", "ak"),
        t("TASK-2214", "Tech-transfer document pack upload (SharePoint library)", "merged", "medium"),
        t("TASK-2240", "Stability-study tracker on the product record", "build", "medium", "cx", "Oct 28"),
        t("TASK-2255", "Revision history on briefs (who / what / when)", "backlog", "low"),
      ],
    },
    {
      id: "BKT-FINANCE", name: "Finance", health: "track", owner: "mo", target: "Sep 01", started: "Jun 01",
      desc: "Deposits, invoicing and credit applications posting to the BC general ledger.",
      closed: 88, total: 96, done: 80, cancelled: 8,
      prd: { label: "TASK-2188", href: "#", type: "task" }, repos: ["plx-bc-posting"],
      tasks: [
        t("TASK-2188", "Deposit → GL posting: receipt evidence attached to the journal", "merged", "urgent", "mo"),
        t("TASK-2190", "Credit application: Dun & Bradstreet pull + approval routing", "qa", "high", "mo", "Oct 22", false, "verify"),
        t("TASK-2197", "Invoice PDF numbering parity with Sage 300 history", "backlog", "medium", null, "Nov 05"),
      ],
    },
    {
      id: "BKT-COMMS-HUB-CSM-O2I", name: "Communications Hub, Customer-Supplied Materials & Order-to-Invoice", health: "risk", owner: "mo", target: "Oct 31", started: "Aug 11",
      desc: "One thread per order: messages, customer-supplied materials receipts and the invoice trail.",
      closed: 9, total: 38, done: 9, cancelled: 0,
      prd: { label: "README.md", href: "#", type: "md" }, repos: ["plx-customer-portal"],
      tasks: [
        t("TASK-2601", "Order thread: unified message + document timeline", "build", "high", "cx", "Oct 19"),
        t("TASK-2604", "CSM receipt: lot, quantity, COA upload and QC hold", "build", "urgent", "ak", "Oct 18", true),
        t("TASK-2612", "Invoice trail: link shipment → invoice → payment", "backlog", "high", null, "Nov 12"),
        t("TASK-2615", "Email digest of unread order messages (daily)", "backlog", "low"),
      ],
    },
    {
      id: "BKT-PORTAL-IDENTITY", name: "Portal Identity & Session Hardening", health: "track", owner: "va", target: "Sep 30", started: "Aug 01",
      desc: "Entra ID sign-in, session lifetimes and admission rules for customer users.",
      closed: 19, total: 21, done: 19, cancelled: 0,
      prd: { label: "PRD.md", href: "#", type: "md" }, repos: ["plx-customer-portal"],
      tasks: [
        t("TASK-2702", "Entra External ID: invite-only admission with domain allow-list", "merged", "urgent", "va"),
        t("TASK-2709", "Session: 12h idle timeout + silent refresh", "merged", "high"),
        t("TASK-2718", "Sign-in audit: who / when / IP into the compliance log", "qa", "medium", "cl", "Oct 20", false, "verify"),
      ],
    },
  ];

  const project = {
    id: "PRJ-PORTAL-GOLIVE", name: "PLX Portal Go-Live",
    desc: "Umbrella project for all PLX Portal go-live initiatives.",
    health: "track", owner: "va", target: "Dec 18", started: "Jun 12",
    sync: { state: "synced", ts: "Today · 19:11" },
    initiatives: 16, total: 2188, closed: 1844, done: 1551, cancelled: 293, doing: 96, pct: 84,
  };

  const docLinks = [
    { scope: "WMS Integration", label: "wms-uom-genealogy-decision.md", type: "md", href: "#" },
    { scope: "Product Development", label: "SPEC.md", type: "md", href: "#" },
    { scope: "Finance", label: "TASK-2188", type: "task", href: "#" },
    { scope: "QMS", label: "PRD-poc.md", type: "md", href: "#" },
    { scope: "Backend Infra", label: "133", type: "issue", href: "#" },
    { scope: "UAT", label: "PRD.md", type: "md", href: "#" },
    { scope: "Mission Control / Ops", label: "SPEC.md", type: "md", href: "#" },
    { scope: "Communications Hub, Customer-Supplied Materials & Order-to-Invoice", label: "README.md", type: "md", href: "#" },
    { scope: "Goals & Production Reporting", label: "PRD-goals-production.md", type: "md", href: "#" },
    { scope: "Portal Identity & Session Hardening", label: "PRD.md", type: "md", href: "#" },
  ];

  const sidebar = {
    projects: [
      { name: "PLX Portal Go-Live", health: "track", active: true },
      { name: "Infra Project", health: "track" },
      { name: "BC Go-Live Execution (risk-tiered)", health: "risk" },
      { name: "Stage Rail / Trading Lab rollout", health: "risk" },
      { name: "PLX_MC Frontier", health: "track" },
      { name: "PLX SharePoint site", health: "track" },
      { name: "Dell disk health", health: "risk" },
      { name: "Sourcing Module Rework", health: "risk" },
    ],
    initiatives: [
      { name: "WMS Integration", health: "track" },
      { name: "Decoupling API", health: "track" },
      { name: "Product Development", health: "track" },
      { name: "Finance", health: "track" },
      { name: "QMS", health: "track" },
      { name: "Shopify → Business Central", health: "risk" },
      { name: "Backend Infra", health: "track" },
      { name: "UAT", health: "track" },
      { name: "Mission Control / Ops", health: "track" },
      { name: "PLX_MC PROJECTS", health: "track" },
      { name: "Frontier P1 — Identity, Admission & Session", health: "risk" },
      { name: "Frontier P2 — Durable Events", health: "track" },
      { name: "Frontier P3 — Live Freshness", health: "track" },
      { name: "Frontier P4 — Runtime Approvals", health: "track" },
      { name: "Frontier P5 — Orchestration", health: "track" },
      { name: "Hardening", health: "track" },
      { name: "Knowledge Hub", health: "track" },
      { name: "Customer Master Unification", health: "track" },
    ],
  };

  // Initiative-page extras (WMS Integration).
  const bucketExtras = {
    milestones: [
      { id: "M-1", name: "Pick queue live on Sandbox", sp: "SharePoint · Milestone Register", state: "done" },
      { id: "M-2", name: "WMS UAT P0–P5 signed off", sp: "SharePoint · Milestone Register", state: "now" },
      { id: "M-3", name: "Finished-goods posting to BC prod", sp: "SharePoint · Milestone Register", state: "risk" },
      { id: "M-4", name: "FileMaker pick list retired", sp: "SharePoint · Milestone Register", state: "upcoming" },
    ],
    risks: [
      { id: "R-1", title: "UOM mismatch between portal cases and BC eaches on pick slips", mit: "Conversion table seeded nightly from BC item cards (TASK-2802); pick slip blocked on unknown UOM.", like: "Medium", impact: "High", owner: "va" },
      { id: "R-2", title: "Staging area overfills when AOs release in a batch", mit: "Capacity warning on release (TASK-2811); manual hold by the warehouse lead until then.", like: "High", impact: "Medium", owner: "ak" },
    ],
    trace: { satisfied: 14, inFlight: 3, gaps: 1 },
    comments: [
      { id: "c1", author: "va", ts: "Today · 17:42", body: "@cx please re-run the P0 pick-slip suite against Sandbox after the UOM seed lands — we need the evidence bundle attached before Friday's review." },
      { id: "c2", author: "ak", ts: "Yesterday · 09:15", body: "QC holds on customer-supplied lots are now visible in the pick queue. Flagging R-2 as the next thing to close." },
    ],
    events: [
      { who: "cx", what: "moved TASK-2791 to In progress", age: "2h" },
      { who: "va", what: "set Target to Aug 01", age: "1d" },
      { who: "cl", what: "attached evidence to TASK-2802", age: "2d" },
    ],
  };

  window.MC_DATA = { actors, STAGES, PRIORITY, buckets, project, docLinks, sidebar, bucketExtras };
})();
