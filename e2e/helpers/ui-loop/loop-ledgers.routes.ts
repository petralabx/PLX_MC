// UI-loop route descriptors for the loop-ledgers surface (G2/G4 traceability).
// The loop-ledgers screen is reached through the MC shell sidebar, not a URL
// route, so the gate specs navigate via openSidebar("Loop ledgers"). This
// descriptor keeps the adapter's routesGlob non-empty and documents the surface
// and its three sub-views for the gate pack.
export const loopLedgersRoutes = [
  { path: "/", name: "loop-ledgers", subviews: ["index", "detail", "gallery"] },
] as const;
