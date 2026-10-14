"use client";

// One frame for every Goals & Production section: a card with a real heading,
// its body, and a source line naming the queries and run behind it. The body
// is a skeleton while loading and "Failed to load" + Retry when the page model
// could not be read or the section could not render. All three states sit in
// the same min-height box, so nothing below moves (mc-goals.css).

import { Component, type ReactNode } from "react";

export type SectionState = "loading" | "failed" | "ready";

export function Section({
  id,
  title,
  note,
  source,
  state,
  onRetry,
  size = "md",
  bare = false,
  resetKey,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  /** "From queries … · run #41, Oct 14, 6:00 AM" (shown when ready). */
  source?: string | null;
  state: SectionState;
  onRetry: () => void;
  /** The reserved height while loading or failed: matches the section's usual size. */
  size?: "sm" | "md" | "lg";
  /** No card around it (the goal cards and the rules carry their own frames). */
  bare?: boolean;
  /** Changes when a new page model arrives: a section that failed to render tries again. */
  resetKey?: unknown;
  children?: ReactNode;
}) {
  const headingId = `goals-${id}-h`;
  return (
    <section
      className={`${bare ? "gp-bare" : "chartcard"} gp-sec gp-${size}`}
      aria-labelledby={headingId}
      data-testid={`goals-${id}`}
    >
      <h2 className="chartcard-title" id={headingId}>
        {title}
      </h2>
      {note && state === "ready" ? <p className="gp-note">{note}</p> : null}
      {state === "loading" ? <Skeleton /> : null}
      {state === "failed" ? <Failed onRetry={onRetry} /> : null}
      {state === "ready" ? (
        <SectionBoundary onRetry={onRetry} resetKey={resetKey}>
          {children}
        </SectionBoundary>
      ) : null}
      {source && state === "ready" ? <p className="gp-src">{source}</p> : null}
    </section>
  );
}

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="gp-skel" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="gp-failed">
      <p>Failed to load.</p>
      <button type="button" className="btn ghost sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/**
 * A section that throws while rendering shows "Failed to load" in place; the
 * rest of the page stays. It tries again on its own Retry, or when a new page
 * model arrives (resetKey), whoever loaded it.
 */
class SectionBoundary extends Component<{ onRetry: () => void; resetKey?: unknown; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  componentDidCatch(error: unknown) {
    console.error("[goals] a section failed to render: %s", error instanceof Error ? error.message : String(error));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Failed
        onRetry={() => {
          this.setState({ failed: false });
          this.props.onRetry();
        }}
      />
    );
  }
}
