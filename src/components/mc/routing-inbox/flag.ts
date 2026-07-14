// Kill switch for the Routing Inbox UI + session APIs (P9).
// Default OFF — unset / anything other than "1" hides nav and rejects APIs.
// NEXT_PUBLIC_ variant lets the client shell gate the sidebar without a
// separate build-time flag file.

const ENV_FLAG = "PLX_MC_ROUTING_INBOX_ENABLED";

function envEnabled(): boolean {
  // Static property access so Next can inline NEXT_PUBLIC_* at build time.
  // Dynamic `process.env[key]` is not replaced and stays undefined in the browser.
  return (
    process.env.PLX_MC_ROUTING_INBOX_ENABLED === "1" ||
    process.env.NEXT_PUBLIC_PLX_MC_ROUTING_INBOX_ENABLED === "1"
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
