"use client";

// Revenue → How it adds up (TASK-4373): the Revenue card's headline taken
// apart, in the tab panel under the pinned cards. Three tables (how the
// headline adds up, the product lines, the currencies) and the notes on the
// data. Every figure is already in the page model (revenueGoal or
// revenueScope, revenueByClass, revenueByBusinessLine, creditNotes,
// pendingShipments): nothing is read again. Amounts are to the cent, so each
// table adds up exactly. It follows scope=mfg (every class but Exclusive
// Distribution) and the salesperson filter, as the card does.

import type { ReactNode } from "react";

import type { ClassRevenueTotals, RevenueScope } from "@/lib/reporting/goals";
import { sumClassTotals } from "@/lib/reporting/goals/class-totals";

import { cents, count, day, plural, rate, usdCents, type ReadyPage } from "./helpers";

type LineAmounts = {
  manufacturingCadCents: number;
  distributionCadCents: number;
  servicesCadCents: number;
};

function plusLines(a: LineAmounts, b: LineAmounts): LineAmounts {
  return {
    manufacturingCadCents: a.manufacturingCadCents + b.manufacturingCadCents,
    distributionCadCents: a.distributionCadCents + b.distributionCadCents,
    servicesCadCents: a.servicesCadCents + b.servicesCadCents,
  };
}

const lineSum = (a: LineAmounts) => a.manufacturingCadCents + a.distributionCadCents + a.servicesCadCents;

const LINE_RULE =
  "Manufacturing: the item code is a finished good in the MRP. Services: a 3PL service, including a Sage miscellaneous charge whose code or description is 3PL. Distribution: every other product. Freight, lab and other accessorial charges stay on the charges line.";

type Sign = "" | "+" | "−" | "=";

interface Row {
  key: string;
  sign: Sign;
  label: string;
  sub?: string;
  cents: number;
  /** sub: a running total; total: the table's last line; hand: entered by hand. */
  kind?: "sub" | "total" | "hand";
  testId?: string;
}

interface Note {
  key: string;
  text: string;
  /** Data the run couldn't read or a refresh that moved under it: shown in the information blue (decision 9: amber means at risk only). */
  flag?: boolean;
  testId?: string;
}

const hasHand = (byHand: { entries: number; cadCents: number }) => byHand.entries > 0 || byHand.cadCents !== 0;

function notConverted<T extends { currency: string; cents: number }>(list: readonly T[], unit: (c: T) => string): string {
  return list.map((c) => `${c.currency} ${(c.cents / 100).toLocaleString("en-US")} (${unit(c)})`).join(", ");
}

export function RevenueBreakdown({ page, scope = "all" }: { page: ReadyPage; scope?: RevenueScope }) {
  const rev = page.model.revenue;
  const mfg = scope === "mfg" ? page.revenueScope : null;
  const goal = mfg ?? page.revenueGoal;
  const narrowed = page.salespeople?.applied ? page.salespeople : null;
  const creditNotes = page.creditNotes;
  const pending = page.pendingShipments;
  const byClass = page.revenueByClass;
  // The scope's classes added up, the same rows revenueScope adds for the headline.
  const totals: ClassRevenueTotals | null =
    goal && byClass
      ? goal.excluded.length === 0
        ? byClass.total
        : sumClassTotals(byClass.rows.filter((row) => !goal.excluded.includes(row.customerClass)))
      : null;
  // The rate the USD figures are at: the run's Bank of Canada rate, or the fixed Sage rate (TASK-3780).
  const rateText =
    rev.basis === "sage"
      ? `${rate(rev.rate)} (Sage rate)`
      : `${rate(page.fx.rate)} (${page.fx.stale ? `stored rate from ${day(page.fx.date)}; the Bank of Canada rate couldn't be fetched` : `Bank of Canada, ${day(page.fx.date)}`})`;
  const invoicedLabel = mfg ? "Manufacturing customers, charges included" : "Invoiced, charges included";

  // ─── How the headline adds up ──────────────────────────────────────────
  const ledger: Row[] = [];
  const notes: Note[] = [];
  if (goal) {
    if (mfg) {
      ledger.push({
        key: "all",
        sign: "",
        label: `${narrowed ? "All their customers" : "All customers"}, charges included`,
        cents: mfg.totalCadCents + mfg.excludedCadCents,
      });
      ledger.push({
        key: "excluded",
        sign: "−",
        label: "Exclusive Distribution",
        sub: "left out: manufacturing customers only",
        cents: mfg.excludedCadCents,
        testId: "goals-revenue-mfg",
      });
      ledger.push({ key: "scope", sign: "=", label: invoicedLabel, cents: mfg.totalCadCents, kind: "sub" });
    } else if (totals) {
      ledger.push({
        key: "sage",
        sign: "",
        label: "Sage invoices",
        sub: `${plural(totals.cad.invoices + totals.usd.invoices, "invoice", "invoices")}, charges included`,
        cents: totals.totalCadCents - totals.byHand.cadCents,
      });
      if (hasHand(totals.byHand)) {
        ledger.push({
          key: "hand",
          sign: "+",
          label: "Entered by hand",
          sub: `${plural(totals.byHand.entries, "entry", "entries")}, freight included`,
          cents: totals.byHand.cadCents,
          kind: "hand",
        });
      }
      ledger.push({ key: "invoiced", sign: "=", label: invoicedLabel, cents: goal.totalCadCents, kind: "sub" });
    } else {
      ledger.push({ key: "invoiced", sign: "", label: invoicedLabel, cents: goal.totalCadCents });
    }
    ledger.push({
      key: "charges",
      sign: "−",
      label: "Freight & other charges",
      sub: "left out of revenue",
      cents: goal.chargesCadCents,
      testId: "goals-revenue-charges",
    });
    ledger.push({ key: "product", sign: "=", label: "Invoiced product", cents: goal.invoicedProductCadCents, kind: "sub" });
    if (pending?.access === "read") {
      ledger.push({
        key: "pending",
        sign: "+",
        label: "Shipped, not yet invoiced",
        sub: `estimate, ${plural(goal.pendingShipments, "shipment", "shipments")}`,
        cents: goal.pendingCadCents,
        testId: "goals-revenue-pending",
      });
    }
    if (creditNotes?.access === "read") {
      // Credited 3PL service charges count here, as 3PL charges count in revenue (business-line.ts applyServiceCharges).
      ledger.push({
        key: "returns",
        sign: "−",
        label: "Returns",
        sub: plural(goal.returnsNotes, "credit note", "credit notes"),
        cents: goal.returnsCadCents,
        testId: "goals-revenue-returns",
      });
    }
    ledger.push({ key: "revenue", sign: "=", label: "Revenue", sub: "the card’s headline", cents: goal.goalCadCents, kind: "total" });

    if (goal.returnsChargesCadCents !== 0) {
      notes.push({
        key: "returns-charges",
        text: `Returns leave out ${cents(goal.returnsChargesCadCents)} of credited freight & other charges, as charges are.`,
      });
    }
    if (creditNotes && creditNotes.access !== "read") {
      notes.push({
        key: "returns-missing",
        text: `Returns not deducted: Sage’s credit notes can’t be read yet (needs ${creditNotes.missing.join(", ")}).`,
        flag: true,
        testId: "goals-revenue-returns",
      });
    }
    if (pending && pending.access !== "read") {
      notes.push({ key: "pending-missing", text: "Shipped, not invoiced: not included (needs access)", flag: true, testId: "goals-revenue-pending" });
    }
    if (!goal.matchesCard) {
      notes.push({
        key: "moved",
        text: `Sage changed during this refresh, so this can be off from the ${mfg ? "class table" : "card"} until the next one.`,
        flag: true,
      });
    }
  } else {
    // A run stored before the goal split charges out (TASK-3952): the card's own figures.
    ledger.push({ key: "sage", sign: "", label: "Sage invoices", sub: "charges included", cents: rev.inSystemCents });
    if (rev.byHandCents !== 0) {
      ledger.push({ key: "hand", sign: "+", label: "Entered by hand", sub: "freight included", cents: rev.byHandCents, kind: "hand" });
    }
    ledger.push({ key: "revenue", sign: "=", label: "Revenue, charges included", sub: "the card’s headline", cents: rev.totalCents, kind: "total" });
  }

  // ─── Product lines ────────────────────────────────────────────────────
  const split = page.revenueByBusinessLine;
  let lines: Row[] | null = null;
  if (split?.state === "waiting") {
    notes.push({ key: "lines-waiting", text: `Business lines: ${split.waiting}`, flag: true, testId: "goals-revenue-lines" });
  } else if (split) {
    const block = scope === "mfg" ? split.mfg : split.all;
    // When the headline includes shipped-not-invoiced, the estimate folds into the three lines.
    const includePending = !!goal && "pendingCadCents" in goal;
    const shown = includePending ? plusLines(block.amounts, block.pending) : block.amounts;
    const total = lineSum(shown);
    const share = (c: number) => (total > 0 ? `${((c / total) * 100).toFixed(1)}% of revenue` : undefined);
    lines = [
      { key: "mfg", sign: "", label: "Manufacturing", sub: share(shown.manufacturingCadCents), cents: shown.manufacturingCadCents },
      { key: "dist", sign: "+", label: "Distribution", sub: share(shown.distributionCadCents), cents: shown.distributionCadCents },
      { key: "svc", sign: "+", label: "Services (3PL)", sub: share(shown.servicesCadCents), cents: shown.servicesCadCents },
      // Without the goal split (a run before TASK-3952) the card's headline includes charges and these lines don't.
      { key: "total", sign: "=", label: "Revenue", sub: goal ? "the card’s headline" : "product only", cents: total, kind: "total" },
    ];
    const pendingSum = lineSum(block.pending);
    if (!includePending && pendingSum !== 0) {
      notes.push({
        key: "lines-pending",
        text: `Shipped, not invoiced (not in this headline): Manufacturing ${cents(block.pending.manufacturingCadCents)} · Distribution ${cents(block.pending.distributionCadCents)} · Services (3PL) ${cents(block.pending.servicesCadCents)}.`,
      });
    }
    if (split.finishedGoodsUnavailable) {
      notes.push({
        key: "fg",
        text: "The MRP finished-good list can’t be read, so nothing is counted as Manufacturing. 3PL charges still count as Services.",
        flag: true,
        testId: "goals-finished-goods-unavailable",
      });
    }
    if (split.ambiguousCodes.length > 0) {
      notes.push({ key: "ambiguous", text: `Counted as Manufacturing (also a 3PL code): ${split.ambiguousCodes.join(", ")}.`, flag: true });
    }
    if (split.unitemizedInvoices > 0) {
      notes.push({
        key: "unitemized",
        text: `${split.unitemizedInvoices} ${split.unitemizedInvoices === 1 ? "invoice has" : "invoices have"} product and no item lines, so that product counts as Distribution.`,
      });
    }
    if (split.returnsShared > 0) {
      notes.push({
        key: "shared",
        text: `${split.returnsShared} ${split.returnsShared === 1 ? "credit note has" : "credit notes have"} no item lines this month, so ${split.returnsShared === 1 ? "it follows" : "they follow"} the class’s product mix.`,
      });
    }
    if (split.pendingWithoutLines > 0 && (includePending || pendingSum !== 0)) {
      notes.push({
        key: "pending-lines",
        text: `${split.pendingWithoutLines} shipped-not-invoiced ${split.pendingWithoutLines === 1 ? "shipment has" : "shipments have"} no item lines, so ${split.pendingWithoutLines === 1 ? "it counts" : "they count"} as Distribution.`,
      });
    }
  }

  // ─── By currency ──────────────────────────────────────────────────────
  // The scope's classes when there are any (they add to the ledger's invoiced total), else the card's month.
  const cur: Pick<ClassRevenueTotals, "cad" | "usd" | "byHand" | "totalCadCents" | "otherCurrencies"> = totals ?? {
    cad: rev.cad,
    usd: rev.usd,
    byHand: { entries: 0, cadCents: rev.byHandCents },
    totalCadCents: rev.totalCents,
    otherCurrencies: rev.otherCurrencies,
  };
  const currency: Row[] = [
    { key: "cad", sign: "", label: "CAD invoices", sub: plural(cur.cad.invoices, "invoice", "invoices"), cents: cur.cad.cents },
    {
      key: "usd",
      sign: "+",
      label: "USD invoices",
      sub: `${plural(cur.usd.invoices, "invoice", "invoices")}, ${usdCents(cur.usd.cents)} at ${rateText}`,
      cents: cur.usd.cadCents,
    },
  ];
  if (hasHand(cur.byHand)) {
    currency.push({
      key: "hand",
      sign: "+",
      label: "Entered by hand",
      sub: cur.byHand.entries > 0 ? plural(cur.byHand.entries, "entry", "entries") : undefined,
      cents: cur.byHand.cadCents,
      kind: "hand",
    });
  }
  currency.push({ key: "total", sign: "=", label: invoicedLabel, cents: cur.totalCadCents, kind: "total" });
  if (cur.otherCurrencies.length > 0) {
    notes.push({ key: "other", text: `Not converted or counted: ${notConverted(cur.otherCurrencies, (c) => plural(c.invoices, "invoice", "invoices"))}.` });
  }
  const returned = totals?.returns ?? null;
  const returnsByCurrency =
    returned && returned.notes > 0
      ? `CAD ${cents(returned.cad.cents)} (${count(returned.cad.notes)}) + USD ${usdCents(returned.usd.cents)} (${count(returned.usd.notes)}, ${cents(returned.usd.cadCents)} at ${rateText}) = ${cents(returned.totalCadCents)} returned, charges included${
          returned.otherCurrencies.length > 0 ? `; not converted: ${notConverted(returned.otherCurrencies, (c) => count(c.notes))}` : ""
        }`
      : null;

  return (
    <div className="gp-bd" data-testid="goals-revenue-breakdown">
      <div className="gp-bd-cols">
        <Ledger id="goals-bd-adds" title="How this adds up" rows={ledger} testId="goals-revenue-ledger" />
        {lines ? <Ledger id="goals-bd-lines" title="Product lines" rows={lines} testId="goals-revenue-lines" note={LINE_RULE} /> : null}
        <Ledger
          id="goals-bd-currency"
          title="By currency"
          rows={currency}
          testId="goals-revenue-currency"
          after={
            returnsByCurrency ? (
              <p className="gp-bd-after" data-testid="goals-revenue-currency-returns">
                Credit notes: {returnsByCurrency}
              </p>
            ) : null
          }
        />
      </div>
      <div className="gp-bd-notes">
        <h3 id="goals-bd-notes">Notes on the data</h3>
        {notes.length === 0 ? (
          <p className="gp-bd-none">Nothing to flag in this refresh.</p>
        ) : (
          <ul className="gp-details" aria-labelledby="goals-bd-notes">
            {notes.map((n) => (
              <li key={n.key} className={n.flag ? "gp-note-flag" : undefined} data-testid={n.testId}>
                {n.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Ledger({
  id,
  title,
  rows,
  testId,
  note,
  after,
}: {
  id: string;
  title: string;
  rows: Row[];
  testId: string;
  note?: string;
  after?: ReactNode;
}) {
  const body = rows.filter((r) => r.kind !== "total");
  const total = rows.find((r) => r.kind === "total");
  return (
    <div className="gp-bd-col">
      <h3 id={id}>
        {title} <span className="gp-bd-unit">CAD</span>
      </h3>
      <table className="gp-table gp-ledger" aria-labelledby={id} data-testid={testId}>
        <tbody>
          {body.map((r) => (
            <LedgerRow key={r.key} row={r} />
          ))}
        </tbody>
        {total ? (
          <tfoot>
            <LedgerRow row={total} />
          </tfoot>
        ) : null}
      </table>
      {note ? <p className="gp-bd-after">{note}</p> : null}
      {after}
    </div>
  );
}

function LedgerRow({ row }: { row: Row }) {
  // A negative amount on a + or − row flips the sign, so the row never reads "− -$120.00".
  const flip = row.cents < 0 && (row.sign === "+" || row.sign === "−");
  const sign: Sign = flip ? (row.sign === "+" ? "−" : "+") : row.sign;
  const amount = flip ? -row.cents : row.cents;
  // "gp-bd-subtotal", not "sub": `.mc .sub` is a flex row in mc-task.css. "hand" picks up the .gp-table by-hand row style.
  const cls = row.kind === "sub" ? "gp-bd-subtotal" : row.kind === "hand" ? "hand" : undefined;
  return (
    <tr className={cls} data-testid={row.testId}>
      <th scope="row">
        <span className="gp-bd-sign">{sign}</span> <span className="gp-bd-label">{row.label}</span>
        {row.sub ? <span className="gp-bd-sub"> {row.sub}</span> : null}
      </th>
      <td className="num">{cents(amount)}</td>
    </tr>
  );
}
