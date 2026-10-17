#!/usr/bin/env node
// Writes the revenue forecast's customer classes (TASK-3177) from the sales
// workbook's "Customer categories" sheet (customer code in column A, class in
// column C) to src/lib/reporting/goals/customer-classes.json. Re-run it when a
// new workbook arrives, then commit the JSON:
//
//   node scripts/goals-customer-classes.mjs <workbook.xlsx> "<source note>"

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";

const CLASSES = ["Exclusive Manufacturing", "Exclusive Distribution", "Mixed"];
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "reporting", "goals", "customer-classes.json");

const [file, source] = process.argv.slice(2);
if (!file || !source) {
  console.error('usage: node scripts/goals-customer-classes.mjs <workbook.xlsx> "<source note>"');
  process.exit(2);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const sheet = workbook.getWorksheet("Customer categories");
if (!sheet) {
  console.error('no "Customer categories" sheet in %s', file);
  process.exit(1);
}

const classes = Object.fromEntries(CLASSES.map((c) => [c, []]));
const seen = new Set();
sheet.eachRow((row, n) => {
  if (n === 1) return;
  const code = String(row.getCell(1).text ?? "").trim().toUpperCase();
  const cls = String(row.getCell(3).text ?? "").trim();
  if (!code) return;
  if (!CLASSES.includes(cls)) throw new Error(`row ${n}: ${code} has class "${cls}", expected one of ${CLASSES.join(", ")}`);
  if (seen.has(code)) throw new Error(`row ${n}: ${code} is listed twice`);
  seen.add(code);
  classes[cls].push(code);
});
for (const codes of Object.values(classes)) codes.sort();

writeFileSync(OUT, `${JSON.stringify({ source, classes }, null, 1)}\n`);
console.log("wrote %s: %s", path.relative(process.cwd(), OUT), CLASSES.map((c) => `${c} ${classes[c].length}`).join(", "));
