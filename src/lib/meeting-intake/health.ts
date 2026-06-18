// Health surface for the meeting-intake integration (EN-004 / WS-4). Declared
// in config/integrations.yaml as the integration's health check. SERVER-ONLY —
// imports the shared secrets accessor for env-presence (no secret values are
// returned). Reports the honest enablement + readiness state so an operator can
// see whether the bridge is on and whether its live paths are configured.

import { azureOpenAiConfigured, graphConfigured } from "@/lib/secrets";

import { meetingIntakeEnabled, meetingIntakeKilled } from "./flag";

export interface MeetingIntakeHealth {
  enabled: boolean;
  killed: boolean;
  graphConfigured: boolean;
  azureExtractorConfigured: boolean;
  // "off" (flag off), "ready" (on + Graph configured), or "degraded" (on but
  // a live dependency is missing — capture works on supplied payloads, the
  // live Graph/Azure paths are dormant).
  status: "off" | "ready" | "degraded";
}

export function meetingIntakeHealth(): MeetingIntakeHealth {
  const enabled = meetingIntakeEnabled();
  const killed = meetingIntakeKilled();
  const graph = graphConfigured();
  const azure = azureOpenAiConfigured();
  const status: MeetingIntakeHealth["status"] = !enabled ? "off" : graph ? "ready" : "degraded";
  return {
    enabled,
    killed,
    graphConfigured: graph,
    azureExtractorConfigured: azure,
    status,
  };
}
