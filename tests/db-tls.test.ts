// TASK-623 — DB TLS: certificate verification is on by default; the vendored
// RDS CA bundle backs verify; insecure mode is an explicit break-glass flag.

import { describe, expect, it } from "vitest";

import { resolveDbSsl } from "@/lib/db/tls";

describe("resolveDbSsl", () => {
  it("defaults to verification against the vendored RDS CA bundle", () => {
    const ssl = resolveDbSsl({});
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toContain("BEGIN CERTIFICATE");
  });

  it("an inline CA env overrides the bundle", () => {
    const ssl = resolveDbSsl({ PLX_MC_DB_CA_CERT: "inline-pem" });
    expect(ssl).toEqual({ rejectUnauthorized: true, ca: "inline-pem" });
  });

  it("insecure mode requires the explicit break-glass flag", () => {
    expect(resolveDbSsl({ PLX_MC_DB_TLS_INSECURE: "1" })).toEqual({
      rejectUnauthorized: false,
    });
    expect(resolveDbSsl({ PLX_MC_DB_TLS_INSECURE: "0" }).rejectUnauthorized).toBe(true);
  });
});
