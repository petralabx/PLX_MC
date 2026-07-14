// Kill switch for the Routing Inbox UI + session APIs (P9).
// Default OFF — unset / anything other than "1" hides nav and rejects APIs.
// NEXT_PUBLIC_ variant lets the client shell gate the sidebar without a
// separate build-time flag file.

const ENV_FLAG = "PLX_MC_ROUTING_INBOX_ENABLED";

function envEnabled(): boolean {
  return (
    process.env[ENV_FLAG] === "1" ||
    process.env[`NEXT_PUBLIC_${ENV_FLAG}`] === "1"
  );
}

let enabled = envEnabled();
let killed = false;

/** Single gate for UI + session APIs. Kill switch wins. */
export function routingInboxEnabled(): boolean {
  return enabled && !killed;
}

export function setRoutingInboxEnabled(on: boolean): void {
  enabled = on;
}

export function tripRoutingInboxKillSwitch(): void {
  killed = true;
}

export function resetRoutingInboxFlag(): void {
  enabled = envEnabled();
  killed = false;
}
