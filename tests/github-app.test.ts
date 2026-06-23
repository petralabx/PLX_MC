// GitHub App auth: JWT minting, installation-token exchange + caching, and the
// shared resolveGithubToken fallback contract. No network — fetch is injected.

import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetInstallationTokenCache,
  getInstallationToken,
  mintAppJwt,
  requestInstallationToken,
  resolveGithubToken,
} from "@/lib/github-app";

// One throwaway RSA keypair for the whole suite (signing/verification only).
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const APP_ENV = ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_INSTALLATION_ID", "GITHUB_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

function configureApp() {
  process.env.GITHUB_APP_ID = "123456";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.GITHUB_APP_INSTALLATION_ID = "789";
}

function tokenResponse(token: string, expiresAtMs: number) {
  return new Response(JSON.stringify({ token, expires_at: new Date(expiresAtMs).toISOString() }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  for (const k of APP_ENV) saved[k] = process.env[k];
  for (const k of APP_ENV) delete process.env[k];
  __resetInstallationTokenCache();
});

afterEach(() => {
  for (const k of APP_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetInstallationTokenCache();
});

describe("mintAppJwt", () => {
  it("produces an RS256 JWT signed by the app private key with sane claims", () => {
    const jwt = mintAppJwt({ appId: "123456", privateKey }, 1_700_000_000_000);
    const [h, p, s] = jwt.split(".");
    expect(h && p && s).toBeTruthy();

    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);

    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload.iss).toBe("123456");
    expect(payload.exp).toBeGreaterThan(payload.iat);
    // GitHub rejects JWTs whose exp is more than 10 minutes out.
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
  });

  it("backdates iat to tolerate clock skew", () => {
    const nowS = 2_000_000_000;
    const jwt = mintAppJwt({ appId: "1", privateKey }, nowS * 1000);
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload.iat).toBeLessThan(nowS);
  });
});

describe("requestInstallationToken", () => {
  it("exchanges the JWT for an installation token (read-only scoped) and parses expiry", async () => {
    const exp = Date.now() + 3_600_000;
    const fetchImpl = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () => tokenResponse("ghs_abc", exp)
    );
    const result = await requestInstallationToken(
      { appId: "1", privateKey, installationId: "789" },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(result.token).toBe("ghs_abc");
    expect(result.expiresAt).toBe(Date.parse(new Date(exp).toISOString()));

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/app/installations/789/access_tokens");
    expect(init?.method).toBe("POST");
    expect(String(init?.headers && (init.headers as Record<string, string>).authorization)).toMatch(/^Bearer /);
    expect(String(init?.body)).toContain('"contents":"read"');
  });

  it("throws an honest error on a non-2xx response (never returns a bogus token)", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }));
    await expect(
      requestInstallationToken(
        { appId: "1", privateKey, installationId: "789" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toThrow(/401|Bad credentials/);
  });
});

describe("getInstallationToken caching", () => {
  it("caches within validity and refreshes near expiry", async () => {
    configureApp();
    const base = 1_800_000_000_000;
    const exp = base + 3_600_000;

    const fetchA = vi.fn(async () => tokenResponse("t1", exp));
    const a = await getInstallationToken({ fetchImpl: fetchA as unknown as typeof fetch, nowMs: base });
    const b = await getInstallationToken({ fetchImpl: fetchA as unknown as typeof fetch, nowMs: base + 1000 });
    expect(a).toBe("t1");
    expect(b).toBe("t1");
    expect(fetchA).toHaveBeenCalledTimes(1); // second call served from cache

    // Within the refresh skew window → a fresh mint.
    const fetchB = vi.fn(async () => tokenResponse("t2", base + 7_200_000));
    const c = await getInstallationToken({ fetchImpl: fetchB as unknown as typeof fetch, nowMs: exp - 30_000 });
    expect(c).toBe("t2");
    expect(fetchB).toHaveBeenCalledTimes(1);
  });
});

describe("resolveGithubToken fallback contract", () => {
  it("returns an App installation token when the App is configured", async () => {
    configureApp();
    const fetchImpl = vi.fn(async () => tokenResponse("ghs_app", Date.now() + 3_600_000));
    const token = await resolveGithubToken({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(token).toBe("ghs_app");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the static GITHUB_TOKEN when the App is not configured", async () => {
    process.env.GITHUB_TOKEN = "ghp_static";
    const token = await resolveGithubToken();
    expect(token).toBe("ghp_static");
  });

  it("returns null when neither the App nor a PAT is configured", async () => {
    expect(await resolveGithubToken()).toBeNull();
  });

  it("falls back to the PAT when the App is configured but the token mint fails", async () => {
    configureApp();
    process.env.GITHUB_TOKEN = "ghp_fallback";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const token = await resolveGithubToken({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(token).toBe("ghp_fallback");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
