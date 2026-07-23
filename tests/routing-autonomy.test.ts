// TASK-635 — autonomy dial per bucket/repo: monotonic lowering only, invalid
// entries ignored, confirm-time assertion for service actors.

import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/route";
import {
  assertAutonomyAllowsConfirmation,
  loadAutonomyDial,
  parseDialMode,
  resolveAutonomyLevel,
} from "@/lib/routing/autonomy";

const dial = {
  repos: { "petralabx/PLX_MC": "suggestion", "petralabx/other": "confirmation" },
  buckets: { "BKT-RISKY": "shadow", "BKT-BROKEN": "warp-speed" },
};

describe("resolveAutonomyLevel", () => {
  it("no dial entries: cohort mode passes through", () => {
    expect(
      resolveAutonomyLevel({ cohortMode: "confirmation", repoId: "unknown/repo", dial })
    ).toEqual({ mode: "confirmation", loweredBy: null });
  });

  it("a repo dial lowers the cohort mode", () => {
    expect(
      resolveAutonomyLevel({ cohortMode: "confirmation", repoId: "petralabx/PLX_MC", dial })
    ).toEqual({ mode: "suggestion", loweredBy: "repo" });
  });

  it("a bucket dial lowers below the repo dial", () => {
    expect(
      resolveAutonomyLevel({
        cohortMode: "confirmation",
        repoId: "petralabx/PLX_MC",
        bucketId: "BKT-RISKY",
        dial,
      })
    ).toEqual({ mode: "shadow", loweredBy: "bucket" });
  });

  it("a dial can never RAISE autonomy above the cohort mode", () => {
    expect(
      resolveAutonomyLevel({ cohortMode: "shadow", repoId: "petralabx/other", dial })
    ).toEqual({ mode: "shadow", loweredBy: null });
  });

  it("invalid dial modes are ignored (fail to cohort mode)", () => {
    expect(parseDialMode("warp-speed")).toBeNull();
    expect(
      resolveAutonomyLevel({ cohortMode: "confirmation", bucketId: "BKT-BROKEN", dial })
    ).toEqual({ mode: "confirmation", loweredBy: null });
  });
});

describe("assertAutonomyAllowsConfirmation", () => {
  it("passes at full confirmation autonomy", () => {
    expect(() =>
      assertAutonomyAllowsConfirmation({ cohortMode: "confirmation", repoId: "x", dial })
    ).not.toThrow();
  });

  it("403s with autonomy_restricted when dialed down", () => {
    try {
      assertAutonomyAllowsConfirmation({
        cohortMode: "confirmation",
        repoId: "petralabx/PLX_MC",
        dial,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("autonomy_restricted");
      expect((err as ApiError).status).toBe(403);
    }
  });
});

describe("committed dial config", () => {
  it("parses and contains no invalid modes", () => {
    const committed = loadAutonomyDial();
    for (const value of [
      ...Object.values(committed.repos ?? {}),
      ...Object.values(committed.buckets ?? {}),
    ]) {
      expect(parseDialMode(value)).not.toBeNull();
    }
  });
});
