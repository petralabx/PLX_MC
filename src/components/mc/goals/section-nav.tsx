"use client";

// Section tabs for the Goals report (TASK-4094). Every section is one tab,
// so one click (or one arrow key) opens it. Groups are labels on the tabs,
// not a second level you have to open first.

import { type KeyboardEvent } from "react";

import { GOALS_TABS, goalsTabName, type GoalsTab } from "./tabs";

export function SectionNav({ active, onSelect }: { active: GoalsTab; onSelect: (tab: GoalsTab) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const ids = GOALS_TABS.map((tab) => tab.id);
    const index = ids.indexOf(active);
    const next =
      event.key === "Home"
        ? ids[0]
        : event.key === "End"
          ? ids[ids.length - 1]
          : event.key === "ArrowRight"
            ? ids[(index + 1) % ids.length]
            : ids[(index - 1 + ids.length) % ids.length];
    onSelect(next);
    document.getElementById(`goals-tab-${next}`)?.focus();
  };

  return (
    <div className="gp-nav" data-testid="goals-section-nav">
      <div className="gp-tablist" role="tablist" aria-label="Report sections" aria-orientation="horizontal" onKeyDown={onKeyDown}>
        {GOALS_TABS.map((tab, index) => {
          const selected = tab.id === active;
          const groupStart = index === 0 || GOALS_TABS[index - 1].group !== tab.group;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`goals-tab-${tab.id}`}
              className={groupStart ? "gp-tab gp-tab-start" : "gp-tab"}
              aria-selected={selected}
              aria-controls="goals-panel"
              tabIndex={selected ? 0 : -1}
              data-testid={`goals-tab-${tab.id}`}
              aria-label={goalsTabName(tab)}
              onClick={() => onSelect(tab.id)}
            >
              <span className="gp-tab-kicker">{tab.group}</span>
              <span className="gp-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
