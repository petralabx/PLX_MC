"use server";

// Server actions for the signed-in chrome (TASK-2977). Signing out clears the
// Mission Control session cookie, then ends the Microsoft session at Entra's
// end-session endpoint, which returns the browser to /signin (TASK-3012). On a
// shared machine the next person is asked which account to use.

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { entraAuthConfigured, entraAuthCredentials } from "@/lib/secrets";

import { entraLogoutUrl } from "./gate";
import { signIn, signOut } from "./index";

export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false });
  if (!entraAuthConfigured()) redirect("/signin");
  // The origin the browser reached, as Auth.js reads it with trustHost.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  redirect(entraLogoutUrl(entraAuthCredentials().tenantId, `${proto}://${host}`));
}

/** Re-run Microsoft sign-in so the session picks up app roles assigned since. */
export async function signInAgainAction(screen: string): Promise<void> {
  const safe = /^[a-z-]+$/.test(screen) ? screen : "home";
  await signIn("microsoft-entra-id", { redirectTo: `/?screen=${safe}` });
}
