import { vmcApiConfigured, vmcApiKey, vmcBaseUrl } from "@/lib/secrets";

import { asArticle, asHit, extractNodes } from "./map";
import type { BrainAskOpenResult, BrainAskSearchResult } from "./types";

function vmcConfig(): { baseUrl: string; apiKey: string } | null {
  if (!vmcApiConfigured()) return null;
  return { baseUrl: vmcBaseUrl(), apiKey: vmcApiKey() };
}

async function vmcGet(path: string): Promise<{ status: number; json: unknown }> {
  const cfg = vmcConfig();
  if (!cfg) return { status: 0, json: null };
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        "X-API-Key": cfg.apiKey,
      },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

export async function searchBrainAsk(
  query: string,
  limit = 8,
): Promise<BrainAskSearchResult> {
  const q = query.trim();
  const configured = Boolean(vmcConfig());
  if (!q || !configured) return { query: q, hits: [], configured };
  const { status, json } = await vmcGet(
    `/api/vmc/knowledge/agent/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  if (status < 200 || status >= 300) return { query: q, hits: [], configured };
  return {
    query: q,
    configured,
    hits: extractNodes(json)
      .map(asHit)
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
      .slice(0, limit),
  };
}

export async function openBrainAskArticle(id: string): Promise<BrainAskOpenResult> {
  const nodeId = id.replace(/^graph:/, "").trim();
  const configured = Boolean(vmcConfig());
  if (!nodeId || !configured) return { article: null, configured };
  const { status, json } = await vmcGet(
    `/api/vmc/knowledge/agent/node/${encodeURIComponent(nodeId)}?include=content`,
  );
  if (status < 200 || status >= 300) return { article: null, configured };
  const [raw] = extractNodes(json);
  return { article: raw ? asArticle(raw) : null, configured };
}
