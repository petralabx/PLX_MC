"use server";

// Server actions for the signed-in chrome (TASK-2977). Signing out clears the
// Mission Control session cookie only; the Microsoft session stays, so the
// next sign-in is one click and reads the user's current Entra app roles.

import { signIn, signOut } from "./index";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/signin" });
}

/** Re-run Microsoft sign-in so the session picks up app roles assigned since. */
export async function signInAgainAction(screen: string): Promise<void> {
  const safe = /^[a-z-]+$/.test(screen) ? screen : "home";
  await signIn("microsoft-entra-id", { redirectTo: `/?screen=${safe}` });
}
