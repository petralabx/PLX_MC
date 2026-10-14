"use client";

// The three goal cards (brief §Screens 3): a status chip, the definition, the
// big number against its target, the system + by-hand split (amber), a
// progress bar and the detail lines. Every figure's tooltip names its query
// and run; the bars are decorative (the text carries every value).

import type { ReactNode } from "react";

import type { GoalStatus } from "@/lib/reporting/goals";

import {
  barParts,
  count,
  day,
  dollars,
  oneDecimal,
  pct,
  rate,
  sourceText,
  usd,
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

export function GoalCards({ page }: { page: ReadyPage }) {
  const { model, settings, run, fx, sections } = page;
  const lb = model.largeBatches;
  const tl = model.truckloads;
  const rev = model.revenue;
  const perDay = settings.largeBatchesPerWorkingDay;
  const lbSource = sourceText(run, sections.largeBatches);
  const tlSource = sourceText(run, sections.truckloads);
  const revSource = sourceText(run, sections.revenue);
  const scheduled = Math.max(0, lb.ifAllRun - lb.total);
  const fullScale = Math.max(tl.lastMonth.full, tl.full.total, 1);
  const rateText = `${rate(fx.rate)} (${fx.stale ? `stored rate from ${day(fx.date)}; the Bank of Canada rate couldn't be fetched` : `Bank of Canada, ${day(fx.date)}`})`;

  return (
    <div className="gp-cards">
      <Card
        id="large-batches"
        title="Large batches"
        status={lb.status}
        definition={`Batches of ${count(settings.largeBatchMinKg)} kg or more, ${count(perDay)} per working day (${count(lb.target)} this month).`}
        big={count(lb.total)}
        of={`of ${count(lb.target)}`}
        source={lbSource}
      >
        <Split
          system={`${count(lb.inSystem)} in FileMaker`}
          byHand={`${count(lb.byHand)} entered by hand`}
          hasHand={lb.byHand > 0}
          title={lbSource}
        />
        <Bar
          parts={barParts({ inSystem: lb.inSystem, byHand: lb.byHand, schedule: scheduled, scale: lb.target, tickAt: lb.dueSoFar })}
          tickLabel={`Due so far: ${count(lb.dueSoFar)}`}
        />
        <ul className="gp-details" title={lbSource}>
          <li>
            Due so far: <b>{count(lb.dueSoFar)}</b> by {day(lb.dueBy)}
          </li>
          <li>
            Needed per working day: <b>{oneDecimal(lb.neededPerDay)}</b> over {count(model.calendar.remaining)} working days
          </li>
          <li>
            If every scheduled batch runs: <b>{count(lb.ifAllRun)}</b> ({count(lb.openFromToday)} from today,{" "}
            {count(lb.openPastDate)} open past their date)
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
        status={rev.status}
        definition={`Invoiced in CAD, product and charges before tax, against ${dollars(rev.targetCents)} a month.`}
        big={dollars(rev.totalCents)}
        of={`of ${dollars(rev.targetCents)}`}
        source={revSource}
      >
        <Split
          system={`${dollars(rev.inSystemCents)} in Sage`}
          byHand={`${dollars(rev.byHandCents)} entered by hand`}
          hasHand={rev.byHandCents !== 0}
          title={revSource}
        />
        <Bar
          parts={barParts({ inSystem: rev.inSystemCents, byHand: rev.byHandCents, scale: rev.targetCents, tickAt: rev.dueSoFarCents })}
          tickLabel={`Due so far: ${dollars(rev.dueSoFarCents)}`}
        />
        <ul className="gp-details" title={revSource}>
          <li>
            Due so far: <b>{dollars(rev.dueSoFarCents)}</b> by {day(rev.dueBy)}
          </li>
          <li>
            Needed per working day: <b>{dollars(rev.neededPerDayCents)}</b>
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
