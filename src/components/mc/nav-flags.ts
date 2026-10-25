// The feature flags that gate nav items, resolved once for every surface: the
// shell, the sidebar and the stars hook (use-stars.ts) read them here.
import { routingInboxEnabled } from "@/components/mc/routing-inbox/flag";
import { meetingIntakeEnabled } from "@/lib/meeting-intake";

import type { NavFlags } from "./nav-model";

export function navFlags(): NavFlags {
  return { meetingIntake: meetingIntakeEnabled(), routingInbox: routingInboxEnabled() };
}
