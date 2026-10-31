"use client";

// The three goal cards (brief §Screens 3): a status chip, the definition, the
// big number against its target, the system + by-hand split (amber), a
// progress bar and the detail lines. Every figure's tooltip names its query
// and run; the bars are decorative (the text carries every value). Narrowed to
// some salespeople's customers (TASK-4277), revenue is set against every
// customer's instead of the month's goal, and Line 1 stays every customer's.
// How the Revenue headline adds up (charges, returns, the shipped-not-invoiced
// estimate, product lines, currencies) is the "How it adds up" tab
// (./revenue-breakdown.tsx, TASK-4373); the card links to it.

import type { ReactNode } from "react";

import type { GoalStatus, RevenueScope } from "@/lib/reporting/goals";

import { barParts, count, day, dollars, pct, sourceText, usd, wholeKg, type BarParts, type ReadyPage } from "./helpers";

function StatusChip({ status }: { status: GoalStatus }) {
  return status === "behind" ? <span className="pv-chip hot">Behind</span> : <span className="pv-chip ok">On track</span>;
}

function Bar({ parts, tickLabel }: { parts: BarParts; tickLabel: string }) {
  return (
    <div className="gp-bar" aria-hidden="true">
      <span className="sys" style={{ width: pct(parts.system) }} />
      <span className="hand" style={{ width: pct(parts.byHand) }} />
      <span className="sched" style={{ width: pct(parts.schedule) }} />
      {parts.tick !== null ? <span className="tick" style={{ left: pct(parts.tick) }} title={tickLabel} /> : null}
    </div>
  );
}

function Split({ system, byHand, hasHand, title }: { system: string; byHand: string; hasHand: boolean; title: string }) {
  return (
    <p className="gp-split" title={title}>
      {system}
      {hasHand ? (
        <>
          {" + "}
          <span className="gp-amber">{byHand}</span>
        </>
      ) : null}
    </p>
  );
}

function Card({
  id,
  title,
  status,
  definition,
  big,
  of,
  source,
  children,
}: {
  id: string;
  title: string;
  status: GoalStatus | null;
  definition: string;
  big: string;
  of: string;
  source: string;
  children: ReactNode;
}) {
  const headingId = `goals-card-${id}`;
  return (
    <article className="gp-card" aria-labelledby={headingId} data-testid={`goals-card-${id}`}>
      <div className="gp-card-h">
        <h3 id={headingId}>{title}</h3>
        {status ? <StatusChip status={status} /> : null}
      </div>
      <p className="gp-def">{definition}</p>
      <p className="gp-big" title={source}>
        <span className="v">{big}</span> <span className="of">{of}</span>
      </p>
      {children}
    </article>
  );
}

export function GoalCards({
  page,
  scope = "all",
  onBreakdown,
}: {
  page: ReadyPage;
  scope?: RevenueScope;
  /** Opens the "How it adds up" tab; absent while that tab is open. */
  onBreakdown?: () => void;
}) {
  const { model, settings, run, sections } = page;
  const mfg = scope === "mfg" ? page.revenueScope : null;
  // Some salespeople's customers (TASK-4277): no status or pace against the goal, which is every customer's.
  const narrowed = page.salespeople?.applied ? page.salespeople : null;
  const every = narrowed?.everyCustomer
    ? mfg
      ? narrowed.everyCustomer.revenueScopeGoalCadCents
      : narrowed.everyCustomer.revenueGoalCadCents
    : null;
  const l1 = model.line1;
  const tl = model.truckloads;
  const rev = model.revenue;
  const l1Source = sourceText(run, sections.line1);
  const tlSource = sourceText(run, sections.truckloads);
  const revSource = sourceText(run, sections.revenue);
  // At scope=mfg the headline, status and pace follow manufacturing customers; the goal stays the same target (TASK-3934).
  // Freight and other charges never count toward the goal (TASK-3952): the headline is the scope's goalCadCents.
  const goal = mfg ?? page.revenueGoal;
  const revTotal = goal ? goal.goalCadCents : rev.totalCents;
  const revStatus = goal ? (goal.status ?? rev.status) : rev.status;
  const revNeeded = goal ? (goal.neededPerDayCents ?? rev.neededPerDayCents) : rev.neededPerDayCents;
  // Returns (TASK-3987): the run's credit notes, subtracted from the headline; null for a run stored before them.
  const creditNotes = page.creditNotes;
  // INTERIM (TASK-3992): shipped, not yet invoiced, inside goal.goalCadCents as an estimate; null when not read.
  const pending = page.pendingShipments;
  const scheduled = Math.max(0, l1.ifAllRunKg - l1.totalKg);
  const fullScale = Math.max(tl.lastMonth.full, tl.full.total, 1);

  return (
    <div className="gp-cards" tabIndex={0} role="group" aria-label="The three goals">
      <Card
        id="line1"
        title="Line 1 bulk"
        status={l1.status}
        definition={`Bulk kg of batches of ${count(settings.line1MinKg)} kg or more (assumed to run on Line 1), ${count(settings.line1KgPerWorkingDay)} kg per working day (${wholeKg(l1.targetKg)} kg this month).`}
        big={wholeKg(l1.totalKg)}
        of={`of ${wholeKg(l1.targetKg)} kg`}
        source={l1Source}
      >
        <Split
          system={`${wholeKg(l1.inSystemKg)} kg in FileMaker`}
          byHand={`${wholeKg(l1.byHandKg)} kg entered by hand`}
          hasHand={l1.byHandKg > 0}
          title={l1Source}
        />
        {narrowed ? (
          <p className="gp-split" data-testid="goals-line1-every-customer">
            Every customer’s: FileMaker has no salesperson.
          </p>
        ) : null}
        <Bar
          parts={barParts({ inSystem: l1.inSystemKg, byHand: l1.byHandKg, schedule: scheduled, scale: l1.targetKg, tickAt: l1.dueSoFarKg })}
          tickLabel={`Due so far: ${wholeKg(l1.dueSoFarKg)} kg`}
        />
        <ul className="gp-details" title={l1Source}>
          <li>
            Due so far: <b>{wholeKg(l1.dueSoFarKg)} kg</b> by {day(l1.dueBy)}
          </li>
          <li>
            Needed per working day: <b>{wholeKg(l1.neededPerDayKg)} kg</b> over {count(model.calendar.remaining)} working days
          </li>
          <li>
            If every scheduled batch runs: <b>{wholeKg(l1.ifAllRunKg)} kg</b> ({wholeKg(l1.scheduledFromTodayKg)} kg from today,{" "}
            {wholeKg(l1.openPastDateKg)} kg open past their date)
          </li>
        </ul>
      </Card>

      <Card
        id="truckloads"
        title="Full truckloads"
        status={null}
        definition={`Shipments with ${usd(settings.fullTruckloadMinUsdCents)} or more of product to the ${count(tl.customers.length)} truckload customers${narrowed ? ` of ${narrowed.label}` : ""}.`}
        big={count(tl.full.total)}
        of={tl.target === null ? "· no monthly target set" : `of ${count(tl.target)}`}
        source={tlSource}
      >
        <Split
          system={`${count(tl.full.inSystem)} in Sage`}
          byHand={`${count(tl.full.byHand)} entered by hand`}
          hasHand={tl.full.byHand > 0}
          title={tlSource}
        />
        <Bar
          parts={barParts({ inSystem: tl.full.inSystem, byHand: tl.full.byHand, scale: fullScale, tickAt: tl.lastMonth.full })}
          tickLabel={`Last month: ${count(tl.lastMonth.full)} full loads`}
        />
        <ul className="gp-details" title={tlSource}>
          <li>
            Partial loads: <b>{count(tl.partial.total)}</b>
            {tl.partial.byHand > 0 ? <span className="gp-amber"> ({count(tl.partial.byHand)} entered by hand)</span> : null}
          </li>
          <li>
            Last month: <b>{count(tl.lastMonth.full)}</b> full, {count(tl.lastMonth.partial)} partial,{" "}
            {usd(tl.lastMonth.productUsdCents)} of product
          </li>
          <li>The bar compares this month’s full loads with last month’s (the tick).</li>
        </ul>
      </Card>

      <Card
        id="revenue"
        title="Revenue"
        status={narrowed ? null : revStatus}
        definition={`Invoiced in CAD, product before tax (freight, lab and other accessorial charges left out; 3PL service charges count${creditNotes?.access === "read" ? "; returns deducted" : ""}${pending?.access === "read" ? "; shipped but not yet invoiced added as an estimate" : ""})${mfg ? ", manufacturing customers (every class but Exclusive Distribution)" : ""}${narrowed ? `, for the customers of ${narrowed.label}, set against every customer’s.` : `, against ${dollars(rev.targetCents)} a month.`}`}
        big={dollars(revTotal)}
        of={narrowed ? (every === null ? "" : `of ${dollars(every)} for every ${mfg ? "manufacturing " : ""}customer`) : `of ${dollars(rev.targetCents)}`}
        source={revSource}
      >
        {goal ? (
          <Split
            system={`${dollars(goal.goalCadCents - goal.byHandGoalCadCents)} in Sage`}
            byHand={`${dollars(goal.byHandGoalCadCents)} entered by hand`}
            hasHand={goal.byHandGoalCadCents !== 0}
            title={revSource}
          />
        ) : (
          <Split
            system={`${dollars(rev.inSystemCents)} in Sage`}
            byHand={`${dollars(rev.byHandCents)} entered by hand`}
            hasHand={rev.byHandCents !== 0}
            title={revSource}
          />
        )}
        <Bar
          parts={
            narrowed
              ? barParts({ inSystem: revTotal, byHand: 0, scale: every ?? rev.targetCents, tickAt: null })
              : goal
              ? barParts({
                  inSystem: goal.goalCadCents - goal.byHandGoalCadCents,
                  byHand: goal.byHandGoalCadCents,
                  scale: rev.targetCents,
                  tickAt: rev.dueSoFarCents,
                })
              : barParts({ inSystem: rev.inSystemCents, byHand: rev.byHandCents, scale: rev.targetCents, tickAt: rev.dueSoFarCents })
          }
          tickLabel={`Due so far: ${dollars(rev.dueSoFarCents)}`}
        />
        <ul className="gp-details" title={revSource}>
          {narrowed ? (
            <li data-testid="goals-revenue-share">
              Share of every customer’s: <b>{every !== null && every > 0 ? pct(revTotal / every) : "—"}</b>. The bar shows it; the{" "}
              {dollars(rev.targetCents)} monthly goal is every customer’s.
            </li>
          ) : (
            <>
              <li>
                Due so far: <b>{dollars(rev.dueSoFarCents)}</b> by {day(rev.dueBy)}
              </li>
              <li>
                Needed per working day: <b>{dollars(revNeeded)}</b>
              </li>
            </>
          )}
        </ul>
        {onBreakdown ? (
          <button type="button" className="tl-link gp-card-link" onClick={onBreakdown} data-testid="goals-revenue-breakdown-link">
            How this adds up
          </button>
        ) : null}
      </Card>
    </div>
  );
}
