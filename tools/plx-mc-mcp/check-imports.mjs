#!/usr/bin/env node
/**
 * Offline module-format check for the PLX-MC MCP wrapper.
 *
 * Every lib/*.mjs module must load both ways a client may reach it: ESM
 * import() (launch.mjs, index.ts via tsx) and CommonJS require() (tsx's
 * transform path). require() of an ES module throws on Node < 22.12 and
 * ERR_REQUIRE_ASYNC_MODULE if a module grows a top-level await, which is the
 * class of defect that broke discovery on Node 24 before any tool was exposed.
 *
 * No network, no credentials, no install: lib/ only uses node: builtins.
 *
 * Usage: node tools/plx-mc-mcp/check-imports.mjs
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const lib = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib");
const require = createRequire(import.meta.url);
const modules = fs.readdirSync(lib).filter((f) => f.endsWith(".mjs")).sort();

let failed = false;
for (const file of modules) {
  const full = path.join(lib, file);
  const esm = await import(pathToFileURL(full).href).catch((e) => e);
  const cjs = (() => {
    try {
      return require(full);
    } catch (e) {
      return e;
    }
  })();
  for (const [kind, result] of [["import()", esm], ["require()", cjs]]) {
    if (result instanceof Error) {
      failed = true;
      console.error(`FAIL: lib/${file} ${kind}: ${result.code ?? ""} ${result.message}`);
    }
  }
  if (!(esm instanceof Error) && !(cjs instanceof Error)) {
    console.log(`ok: lib/${file} (${Object.keys(esm).length} exports, import() + require())`);
  }
}
if (!modules.length) {
  failed = true;
  console.error("FAIL: no lib/*.mjs modules found");
}
console.log(`node ${process.version} on ${process.platform}: ${failed ? "imports FAILED" : "imports passed"}`);
process.exit(failed ? 1 : 0);
