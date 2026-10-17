// Sage's invoice lines on the synthetic reporting replica (TASK-3144), shaped
// like the real sage.oe_invoice_detail: space-padded text, LINENUM spaced by 32,
// 4-decimal quantities, 6-decimal prices and 3-decimal amounts, plus columns the
// report must never read (UNITCOST, EXTICOST, HDRDISC). The invoice header gets
// its INVUNIQ column, the lines' join key. createShipmentLineSourceTables runs
// before the grant script, which grants on them; loadShipmentLineSource fills
// them from fixtures/reporting-goals/2026-10-14/shipment-lines-source.json.
// Not a test file (no .test.ts).

import type { Client } from "pg";

import source from "./fixtures/reporting-goals/2026-10-14/shipment-lines-source.json";

export async function createShipmentLineSourceTables(db: Client): Promise<void> {
  await db.query(`
    ALTER TABLE sage.oe_invoice_header ADD COLUMN invuniq text;
    CREATE TABLE sage.oe_invoice_detail (
      invuniq text, linenum text, linetype text, item text, misccharge text, "desc" text, qtyshipped text, invunit text,
      unitprice text, extinvmisc text, invdisc text, hdrdisc text, unitcost text, exticost text
    );
  `);
}

export async function loadShipmentLineSource(db: Client): Promise<void> {
  await db.query(
    `UPDATE sage.oe_invoice_header h SET invuniq = v.invuniq
       FROM unnest($1::text[], $2::text[]) AS v(invnumber, invuniq)
      WHERE trim(h.invnumber) = v.invnumber`,
    [source.headers.map((h) => h.invnumber), source.headers.map((h) => h.invuniq)]
  );
  for (const d of source.details) {
    await db.query(
      `INSERT INTO sage.oe_invoice_detail (invuniq, linenum, linetype, item, misccharge, "desc", qtyshipped, invunit, unitprice,
         extinvmisc, invdisc, hdrdisc, unitcost, exticost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [d.invuniq, d.linenum, d.linetype, d.item, d.misccharge, d.desc, d.qtyshipped, d.invunit, d.unitprice, d.extinvmisc,
        d.invdisc, d.hdrdisc, d.unitcost, d.exticost]
    );
  }
}
