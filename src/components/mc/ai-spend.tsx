"use client";

// AI Spend — vendor subscription and API cost observatory (placeholder).
// Full implementation tracked in artifacts/platform/2026-06-30-vendor-spend-plan/SPEC.md.

export function AiSpendView() {
  return (
    <div className="mc-main" data-testid="ai-spend-screen">
      <div className="ph">
        <div>
          <span className="kk">System of record · coming soon</span>
          <h1>
            AI <em>spend</em>
          </h1>
          <p className="sub">
            Company-wide subscription and API cost tracking for AI and platform vendors —
            budgets, proactive warnings, and spend visibility across AWS, Anthropic, Cursor,
            and more.
          </p>
        </div>
      </div>
      {/* Standard .empty chassis (glyph + h3 + p) — the previous `mc-empty`
          class was never defined, so this rendered as a bare unstyled
          paragraph (2026-07-06 design-system alignment pass). */}
      <div className="empty">
        <div className="glyph">◎</div>
        <h3>Coming soon</h3>
        <p>
          The vendor spend observatory is on the roadmap. Until it lands, budgets and
          invoices stay with each vendor console.
        </p>
      </div>
    </div>
  );
}
