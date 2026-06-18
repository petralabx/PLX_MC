// Feature flag + kill switch for the meeting-intake bridge (EN-004 / WS-4).
//
// GOVERNANCE (External Integrations contract): this integration can act
// autonomously (it derives tasks from meeting artifacts), so it ships DISABLED
// BY DEFAULT and is gated two ways:
//   1. a feature flag — OFF unless explicitly enabled (env or runtime toggle);
//   2. an independent KILL SWITCH that forces the feature off regardless of the
//      flag, so an operator can hard-stop capture without a redeploy.
// The flag is also the UI gate: the triage surface only renders when enabled.

// Server env opt-in. Absent in committed config (default off). The
// NEXT_PUBLIC_ variant lets a deliberate client build surface the UI; without
// it the flag is off in the browser too.
const ENV_FLAG = "PLX_MC_MEETING_INTAKE_ENABLED";

function envEnabled(): boolean {
  return (
    process.env[ENV_FLAG] === "1" ||
    process.env[`NEXT_PUBLIC_${ENV_FLAG}`] === "1"
  );
}

let enabled = envEnabled();
let killed = false;

// The single gate everything checks. Kill switch wins over the flag.
export function meetingIntakeEnabled(): boolean {
  return enabled && !killed;
}

// Runtime enablement (operator action / server wiring). Does not override the
// kill switch.
export function setMeetingIntakeEnabled(on: boolean): void {
  enabled = on;
}

// Hard stop — trips the kill switch; the feature is off until reset.
export function tripMeetingIntakeKillSwitch(): void {
  killed = true;
}

export function meetingIntakeKilled(): boolean {
  return killed;
}

// Test/operator reset of the flag + kill switch to their committed default
// (off). Used by the triage store's reset and by tests.
export function resetMeetingIntakeFlag(): void {
  enabled = envEnabled();
  killed = false;
}
