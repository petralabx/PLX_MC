// This month's returns (TASK-3987): every Sage credit note dated this month
// (by the credit note's own date, so a return lands in the month it was
// credited, not the month the goods first shipped), one row each. Read like the
// invoices (queries/shipments.ts): items less discount before tax, other charges
// apart, so returns come off the goal on the same basis as revenue counts
// toward it (TASK-3952). Debit notes (adjustment type 2) are not returns and
// are left out. Sage 300's OECRDH header is replicated as sage.oe_crdh
// (the sync's module-prefix name; it is not in the friendly-name map, so there
// is no sage.oe_credit_note_header). Source currency is crsourcurr, the same
// role as an invoice's insourcurr. Confirmed on the staging replica 2026-10-27.
// The login reads it only once a DBA runs
// docs/modules/reporting-goals/readonly-grants-credit-notes.sql: the refresh
// checks CREDIT_NOTE_COLUMNS first (./read-access.ts), so a missing grant (or a
// differently named table) skips the returns and names what's missing, and
// never fails the refresh. Params: $1 today.

import type { CreditNoteRow } from "../types";
import type { ColumnList } from "./read-access";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

/** Exactly the columns the query reads (the grant script grants these). */
export const CREDIT_NOTE_COLUMNS = [
  [
    "sage",
    "oe_crdh",
    ["crdnumber", "invnumber", "customer", "bilname", "crddate", "crsourcurr", "crditmtot", "crddiscamt", "crdmisc", "crdnetnotx", "adjtype"],
  ],
] as const satisfies ColumnList;

interface Row {
  credit_note: string;
  invoice: string | null;
  customer_code: string | null;
  customer: string | null;
  credit_date: string;
  currency: string;
  product_value: string;
  other_charges: string;
  net_before_tax: string;
}

export const creditNotesQuery: DatasetQuery<Row, CreditNoteRow[]> = {
  name: "credit-notes",
  sql: `${MONTH_WINDOW}
SELECT trim(c.crdnumber) AS credit_note,
       nullif(trim(c.invnumber), '') AS invoice,
       nullif(trim(c.customer), '') AS customer_code,
       nullif(trim(c.bilname), '') AS customer,
       to_date(c.crddate, 'YYYYMMDD')::text AS credit_date,
       trim(c.crsourcurr) AS currency,
       c.crditmtot::numeric - c.crddiscamt::numeric AS product_value,
       c.crdmisc::numeric AS other_charges,
       c.crdnetnotx::numeric AS net_before_tax
FROM sage.oe_crdh c, cut
WHERE c.crddate >= cut.m0s AND c.crddate < cut.n0s
  AND trim(coalesce(c.adjtype::text, '')) <> '2'
ORDER BY credit_date, credit_note`,
  map: (rows) =>
    rows.map((r) => ({
      creditNote: r.credit_note,
      invoice: r.invoice,
      customerCode: r.customer_code,
      customer: r.customer,
      creditDate: r.credit_date,
      currency: r.currency,
      productValue: r.product_value,
      otherCharges: r.other_charges,
      netBeforeTax: r.net_before_tax,
    })),
};
