// TASK-3012: every shared-secret check (CRON_SECRET bearer, Basic break-glass,
// COMPLIANCE_CI_TOKEN) goes through one constant-time helper. It fails closed
// when the secret is unset or blank, so `Bearer ` / `Bearer undefined` never
// match, and hashes both sides first so a wrong length returns no faster.

import { describe, expect, it } from "vitest";

import { secretMatches } from "@/lib/auth/gate";

describe("secretMatches", () => {
  it("accepts the exact credential, with or without a scheme prefix", async () => {
    expect(await secretMatches("topsecret", "topsecret")).toBe(true);
    expect(await secretMatches("Bearer topsecret", "topsecret", "Bearer ")).toBe(true);
  });

  it("rejects a wrong, longer, shorter, or differently-cased credential", async () => {
    expect(await secretMatches("Bearer nope", "topsecret", "Bearer ")).toBe(false);
    expect(await secretMatches("Bearer topsecret2", "topsecret", "Bearer ")).toBe(false);
    expect(await secretMatches("Bearer topsecre", "topsecret", "Bearer ")).toBe(false);
    expect(await secretMatches("Bearer TOPSECRET", "topsecret", "Bearer ")).toBe(false);
    expect(await secretMatches("topsecret", "topsecret", "Bearer ")).toBe(false);
  });

  it("rejects a missing credential", async () => {
    expect(await secretMatches(null, "topsecret", "Bearer ")).toBe(false);
    expect(await secretMatches(undefined, "topsecret")).toBe(false);
    expect(await secretMatches("", "topsecret")).toBe(false);
  });

  it("fails closed when the expected secret is unset or blank", async () => {
    expect(await secretMatches("Bearer undefined", undefined, "Bearer ")).toBe(false);
    expect(await secretMatches("Bearer ", "", "Bearer ")).toBe(false);
    expect(await secretMatches("Bearer    ", "   ", "Bearer ")).toBe(false);
    expect(await secretMatches("", "")).toBe(false);
    expect(await secretMatches(null, null)).toBe(false);
  });
});
