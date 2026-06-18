// In-tenant transcript extractor (EN-004 / WS-4, Tier A SHOULD live path).
// SERVER-ONLY — imports the shared secrets accessor; never import from a client
// component (mirrors src/lib/secrets.ts and src/lib/sync/graph.ts).
//
// This is the DEFAULT extractor seam: it sends transcript cues to Azure OpenAI
// *inside the M365/Azure tenant* (data-boundary decision — transcripts never go
// to an external LLM) and asks for action items as JSON. It is exercised only
// when the feature flag is on AND Azure is configured; otherwise it fails
// visibly (no fabricated action items). Tests inject a mock via explicit DI, so
// this path is never hit without live Azure.

import { azureOpenAiConfig, azureOpenAiConfigured } from "@/lib/secrets";

import type {
  ActionItemExtractor,
  ExtractedActionItem,
  MeetingRef,
  TranscriptCue,
} from "./types";

const SYSTEM_PROMPT =
  "You extract concrete action items from a meeting transcript. " +
  "Return ONLY JSON of the form {\"actionItems\":[{\"title\":string," +
  "\"ownerDisplayName\":string|null,\"snippet\":string,\"timestamp\":string}]}. " +
  "title is an imperative task summary; ownerDisplayName is the named owner if " +
  "one is stated, else null; snippet is the verbatim transcript line the item " +
  "came from; timestamp is that cue's start time. Do not invent owners or items.";

function transcriptText(cues: TranscriptCue[]): string {
  return cues
    .map((c) => `[${c.start}] ${c.speaker ? `${c.speaker}: ` : ""}${c.text}`)
    .join("\n");
}

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
}

// The default in-tenant extractor. Throws a clear error when Azure is not
// configured — the caller (capture path) surfaces it honestly rather than
// returning a fabricated empty/parsed result.
export const azureOpenAiExtractor: ActionItemExtractor = async (
  cues: TranscriptCue[],
  meeting: MeetingRef
): Promise<ExtractedActionItem[]> => {
  if (!azureOpenAiConfigured()) {
    throw new Error(
      "Azure OpenAI is not configured — the in-tenant transcript extractor is dormant " +
        "(set AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT)."
    );
  }
  const { endpoint, apiKey, deployment, apiVersion } = azureOpenAiConfig();
  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const resp = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    method: "POST",
    headers: { "content-type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Meeting: ${meeting.title ?? meeting.meetingId}\n\nTranscript:\n${transcriptText(cues)}`,
        },
      ],
    }),
  });
  if (!resp.ok) {
    throw new Error(`Azure OpenAI extraction failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as ChatCompletion;
  const content = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: { actionItems?: ExtractedActionItem[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Azure OpenAI extraction returned non-JSON content.");
  }
  return (parsed.actionItems ?? []).filter((i) => (i.title ?? "").trim().length > 0);
};
