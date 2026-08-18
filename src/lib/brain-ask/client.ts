import { vmcApiConfigured, vmcApiKey, vmcBaseUrl } from "@/lib/secrets";

import { asArticle, asHit, extractNodes } from "./map";
import { classifyBrainAskStatus } from "./status";
import type {
  BrainAskOpenResult,
  BrainAskSearchProbe,
  BrainAskSearchResult,
} from "./types";

const VMC_FETCH_TIMEOUT_MS = 15_000;
export const BRAIN_ASK_PROBE_TIMEOUT_MS = 8_000;
/** Cheap probe query. Response body is discarded; never forwarded to self-check. */
export const BRAIN_ASK_PROBE_QUERY = "plx";

function vmcConfig(): { baseUrl: string; apiKey: string } | null {
  if (!vmcApiConfigured()) return null;
  return { baseUrl: vmcBaseUrl(), apiKey: vmcApiKey() };
}

async function vmcGet(
  path: string,
  timeoutMs = VMC_FETCH_TIMEOUT_MS,
): Promise<{ status: number; json: unknown }> {
  const cfg = vmcConfig();
  if (!cfg) return { status: 0, json: null };
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        "X-API-Key": cfg.apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

function emptySearch(query: string, configured: boolean, httpStatus: number): BrainAskSearchResult {
  return {
    query,
    hits: [],
    configured,
    status: classifyBrainAskStatus(configured, httpStatus),
  };
}

export async function searchBrainAsk(
  query: string,
  limit = 8,
): Promise<BrainAskSearchResult> {
  const q = query.trim();
  const configured = Boolean(vmcConfig());
  if (!q || !configured) return emptySearch(q, configured, 0);
  const { status, json } = await vmcGet(
    `/api/vmc/knowledge/agent/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  if (status < 200 || status >= 300) return emptySearch(q, configured, status);
  return {
    query: q,
    configured,
    status: "ok",
    hits: extractNodes(json)
      .map(asHit)
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
      .slice(0, limit),
  };
}

export async function openBrainAskArticle(id: string): Promise<BrainAskOpenResult> {
  const nodeId = id.replace(/^graph:/, "").trim();
  const configured = Boolean(vmcConfig());
  if (!nodeId || !configured) {
    return {
      article: null,
      configured,
      status: classifyBrainAskStatus(configured, 0),
    };
  }
  const { status, json } = await vmcGet(
    `/api/vmc/knowledge/agent/node/${encodeURIComponent(nodeId)}?include=content`,
  );
  if (status < 200 || status >= 300) {
    return {
      article: null,
      configured,
      status: classifyBrainAskStatus(configured, status),
    };
  }
  const [raw] = extractNodes(json);
  return { article: raw ? asArticle(raw) : null, configured, status: "ok" };
}

export async function probeBrainAskSearch(opts?: {
  timeoutMs?: number;
}): Promise<BrainAskSearchProbe> {
  const configured = Boolean(vmcConfig());
  if (!configured) return { configured: false, ok: false, status: 0 };
  const { status } = await vmcGet(
    `/api/vmc/knowledge/agent/search?q=${encodeURIComponent(BRAIN_ASK_PROBE_QUERY)}&limit=1`,
    opts?.timeoutMs ?? BRAIN_ASK_PROBE_TIMEOUT_MS,
  );
  return {
    configured: true,
    ok: status >= 200 && status < 300,
    status,
  };
}
