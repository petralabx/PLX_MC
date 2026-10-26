"use client";

// The three goal cards (brief §Screens 3): a status chip, the definition, the
// big number against its target, the system + by-hand split (amber), a
// progress bar and the detail lines. Every figure's tooltip names its query
// and run; the bars are decorative (the text carries every value).

import type { ReactNode } from "react";

import type { GoalStatus, RevenueScope } from "@/lib/reporting/goals";

import {
  barParts,
  count,
  day,
  dollars,
  pct,
  rate,
  sourceText,
  usd,
  wholeKg,
  type BarParts,
  type ReadyPage,
} from "./helpers";

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

export function GoalCards({ page, scope = "all" }: { page: ReadyPage; scope?: RevenueScope }) {
  const { model, settings, run, fx, sections } = page;
  const mfg = scope === "mfg" ? page.revenueScope : null;
  const l1 = model.line1;
  const tl = model.truckloads;
  const rev = model.revenue;
  const l1Source = sourceText(run, sections.line1);
  const tlSource = sourceText(run, sections.truckloads);
  const revSource = sourceText(run, sections.revenue);
  // At scope=mfg the headline, status and pace follow manufacturing customers; the goal stays the same target (TASK-3934).
  const revTotal = mfg ? mfg.totalCadCents : rev.totalCents;
  const revStatus = mfg ? (mfg.status ?? rev.status) : rev.status;
  const revNeeded = mfg ? (mfg.neededPerDayCents ?? rev.neededPerDayCents) : rev.neededPerDayCents;
  const scheduled = Math.max(0, l1.ifAllRunKg - l1.totalKg);
  const fullScale = Math.max(tl.lastMonth.full, tl.full.total, 1);
  // The rate the figures are at: the run's Bank of Canada rate, or the fixed Sage rate (TASK-3780).
  const rateText =
    rev.basis === "sage"
      ? `${rate(rev.rate)} (Sage rate)`
      : `${rate(fx.rate)} (${fx.stale ? `stored rate from ${day(fx.date)}; the Bank of Canada rate couldn't be fetched` : `Bank of Canada, ${day(fx.date)}`})`;

  return (
    <div className="gp-cards">
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
        definition={`Shipments with ${usd(settings.fullTruckloadMinUsdCents)} or more of product to the ${count(tl.customers.length)} truckload customers.`}
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
        status={revStatus}
        definition={`Invoiced in CAD, product and charges before tax${mfg ? ", manufacturing customers (every class but Exclusive Distribution)" : ""}, against ${dollars(rev.targetCents)} a month.`}
        big={dollars(revTotal)}
        of={`of ${dollars(rev.targetCents)}`}
        source={revSource}
      >
        {mfg ? (
          <p className="gp-split" title={revSource} data-testid="goals-revenue-mfg">
            + {dollars(mfg.excludedCadCents)} Exclusive Distribution left out = {dollars(mfg.totalCadCents + mfg.excludedCadCents)} all
            customers
            {mfg.matchesCard ? "" : ". Sage changed during this refresh, so this can be off from the class table until the next one"}
          </p>
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
            mfg
              ? barParts({ inSystem: mfg.totalCadCents, byHand: 0, scale: rev.targetCents, tickAt: rev.dueSoFarCents })
              : barParts({ inSystem: rev.inSystemCents, byHand: rev.byHandCents, scale: rev.targetCents, tickAt: rev.dueSoFarCents })
          }
          tickLabel={`Due so far: ${dollars(rev.dueSoFarCents)}`}
        />
        <ul className="gp-details" title={revSource}>
          <li>
            Due so far: <b>{dollars(rev.dueSoFarCents)}</b> by {day(rev.dueBy)}
          </li>
          <li>
            Needed per working day: <b>{dollars(revNeeded)}</b>
          </li>
          <li>
            CAD {dollars(rev.cad.cents)} ({count(rev.cad.invoices)} invoices) + USD {usd(rev.usd.cents)} (
            {count(rev.usd.invoices)} invoices) = {dollars(rev.usd.cadCents)} at {rateText}
          </li>
          {rev.otherCurrencies.length > 0 ? (
            <li>
              Not converted:{" "}
              {rev.otherCurrencies
                .map((c) => `${c.currency} ${(c.cents / 100).toLocaleString("en-US")} (${count(c.invoices)} invoices)`)
                .join(", ")}
            </li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}
