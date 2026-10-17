// The revenue forecast's source tables on the synthetic reporting replica
// (TASK-3151), shaped like the real ones: Sage order entry as space-padded text
// with YYYYMMDD dates, including the columns the forecast must never read
// (COMPLETE, QTYBACKORD, ORIGQTY…); FileMaker's bronze assembly orders and
// order-entry links typed, with the calculated qtymfgleftoe_c it doesn't read;
// silver.finished_products. createForecastSourceTables runs before the grant
// script, which grants on them; loadForecastSource fills them from
// fixtures/reporting-goals/2026-10-14/forecast-source.json and adds the AOs'
// bulk batches to public.batch (dated so that no other dataset sees them).
// Not a test file (no .test.ts).

import type { Client } from "pg";

import source from "./fixtures/reporting-goals/2026-10-14/forecast-source.json";

export async function createForecastSourceTables(db: Client): Promise<void> {
  await db.query(`
    CREATE TABLE sage.oe_order_header (
      orduniq text, ordnumber text, customer text, bilname text, ponumber text, type text, orddate text, expdate text,
      orsourcurr text, reference text, "desc" text, complete text, onhold text DEFAULT '0'
    );
    CREATE TABLE sage.oe_order_detail (
      orduniq text, linenum text, linetype text, item text, "desc" text, expdate text, qtyordered text, qtyshipped text,
      qtybackord text, qtyshptodt text, origqty text, ordunit text, unitprice text, category text, complete text, misccharge text DEFAULT ''
    );
    CREATE TABLE public.assembly_order (
      id bigint PRIMARY KEY, nameamo_c text, status text, datescheduled date, idfinprod bigint, idbatch bigint,
      idbatch_pre bigint, oelist_c text, qtytotal numeric, unitsperbox numeric, qtymfgleftoe_c numeric
    );
    CREATE TABLE public.order_entry (id bigint PRIMARY KEY, erpcode text);
    CREATE TABLE public.order_entry_item (id bigint PRIMARY KEY, idoe bigint);
    CREATE TABLE public.order_entry_item_assembly (id bigint PRIMARY KEY, idoeitem bigint, idassembly bigint);
    CREATE TABLE silver.finished_products (id bigint PRIMARY KEY, code text, erp_code text, name text);
  `);
}

export async function loadForecastSource(db: Client): Promise<void> {
  for (const h of source.orderHeaders) {
    await db.query(
      `INSERT INTO sage.oe_order_header (orduniq, ordnumber, customer, bilname, ponumber, type, orddate, expdate, orsourcurr,
         reference, "desc", complete)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [h.orduniq, h.ordnumber, h.customer, h.bilname, h.ponumber, h.type, h.orddate, h.expdate, h.orsourcurr, h.reference, h.desc, h.complete]
    );
  }
  for (const d of source.orderDetails) {
    await db.query(
      `INSERT INTO sage.oe_order_detail (orduniq, linenum, linetype, item, "desc", expdate, qtyordered, qtyshipped, qtybackord,
         qtyshptodt, origqty, ordunit, unitprice, category, complete)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [d.orduniq, d.linenum, d.linetype, d.item, d.desc, d.expdate, d.qtyordered, d.qtyshipped, d.qtybackord, d.qtyshptodt,
        d.origqty, d.ordunit, d.unitprice, d.category, d.complete]
    );
  }
  for (const f of source.finishedProducts) {
    await db.query(`INSERT INTO silver.finished_products (id, code, erp_code) VALUES ($1, $2, $3)`, [f.id, f.code, f.erp_code]);
  }
  for (const a of source.assemblyOrders) {
    await db.query(
      `INSERT INTO public.assembly_order (id, nameamo_c, status, datescheduled, idfinprod, idbatch, idbatch_pre, oelist_c, qtytotal,
         unitsperbox, qtymfgleftoe_c)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [a.id, a.nameamo_c, a.status, a.datescheduled, a.idfinprod, a.idbatch, a.idbatch_pre, a.oelist_c, a.qtytotal, a.unitsperbox,
        a.qtymfgleftoe_c]
    );
  }
  for (const o of source.orderEntries) await db.query(`INSERT INTO public.order_entry (id, erpcode) VALUES ($1, $2)`, [o.id, o.erpcode]);
  for (const i of source.orderEntryItems) await db.query(`INSERT INTO public.order_entry_item (id, idoe) VALUES ($1, $2)`, [i.id, i.idoe]);
  for (const l of source.orderEntryItemAssemblies) {
    await db.query(`INSERT INTO public.order_entry_item_assembly (id, idoeitem, idassembly) VALUES ($1, $2, $3)`, [l.id, l.idoeitem, l.idassembly]);
  }
  // Realized in June (before the three-month history) or open without planned kg, so only the forecast sees them.
  for (const b of source.bulkBatches) {
    const made = b.status === "Realized";
    await db.query(
      `INSERT INTO public.batch (id, display_batch_number, status, status_qc, line, date_completed, date_scheduled, planned_qty,
         actual_qty, cal_title, updated_at, unit_cost)
       VALUES ($1, $2, $3, $4, '10', $5, $6, $7, $7, $8, '2026-06-20 12:00:00-04', 1.23)`,
      [b.id, b.display_batch_number, b.status, made ? "QC Released" : null, b.date_completed, b.date_scheduled, made ? 5000 : null,
        `${b.display_batch_number} • Bulk`]
    );
  }
}
