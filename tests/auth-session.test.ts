// Session lifecycle (TASK-2977): a session ends 12h after sign-in, when it
// predates the sign-in stamp, or when its email leaves the allowlist, so role
// and allowlist changes apply without waiting for a 30-day cookie to lapse.

import { describe, expect, it } from "vitest";

import { SESSION_MAX_AGE_MS, sessionStillValid } from "@/lib/auth/gate";

const allow = "vince@petrasoap.com,oleg@petrasoap.com";
const now = Date.UTC(2026, 9, 15, 15, 0, 0);

describe("sessionStillValid", () => {
  it("keeps a fresh session for a listed user", () => {
    expect(sessionStillValid({ email: "oleg@petrasoap.com", signedInAt: now - 60_000 }, now, allow)).toBe(true);
  });

  it("ends a session from before the sign-in stamp existed", () => {
    expect(sessionStillValid({ email: "oleg@petrasoap.com" }, now, allow)).toBe(false);
  });

  it("ends a session 12 hours after sign-in, even while in use", () => {
    expect(sessionStillValid({ email: "oleg@petrasoap.com", signedInAt: now - SESSION_MAX_AGE_MS + 1 }, now, allow)).toBe(true);
    expect(sessionStillValid({ email: "oleg@petrasoap.com", signedInAt: now - SESSION_MAX_AGE_MS }, now, allow)).toBe(false);
  });

  it("ends the session of someone removed from the allowlist", () => {
    expect(sessionStillValid({ email: "jesse@petrasoap.com", signedInAt: now - 60_000 }, now, allow)).toBe(false);
  });

  it("keeps an MC.* role holder who is not allowlisted until the 12h limit (TASK-3010)", () => {
    const token = { email: "new.admin@petrasoap.com", roles: ["MC.Admin"], signedInAt: now - 60_000 };
    expect(sessionStillValid(token, now, allow)).toBe(true);
    expect(sessionStillValid({ ...token, signedInAt: now - SESSION_MAX_AGE_MS }, now, allow)).toBe(false);
  });

  it("ends a session with neither an MC.* role nor an allowlist entry", () => {
    expect(
      sessionStillValid({ email: "jesse@petrasoap.com", roles: ["Goals.Viewer"], signedInAt: now - 60_000 }, now, allow)
    ).toBe(false);
  });

  it("rejects a stamp from the future or a non-number", () => {
    expect(sessionStillValid({ email: "oleg@petrasoap.com", signedInAt: now + 60_000 }, now, allow)).toBe(false);
    expect(sessionStillValid({ email: "oleg@petrasoap.com", signedInAt: "yesterday" }, now, allow)).toBe(false);
  });
});
