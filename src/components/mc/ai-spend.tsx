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
      <div className="mc-empty" style={{ marginTop: "var(--p-space-6)" }}>
        <p style={{ fontSize: "var(--p-text-body)", color: "var(--p-ink-2)" }}>Coming soon.</p>
      </div>
    </div>
  );
}
