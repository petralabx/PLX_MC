// The branded sign-in surface (Auth.js `pages.signIn`). This replaces the
// stock /api/auth/signin screen — the only page an unauthenticated visitor
// sees — so the PLX brand (Mazius, paper tokens, logo) carries the threshold
// into the system of record. Server component; the Entra hand-off runs as a
// server action. Reachable pre-auth via isPublicAsset (see src/lib/auth/gate).
import Image from "next/image";
import { redirect } from "next/navigation";

import { Kicker } from "@/components/brand";
import { auth, oidcEnabled, signIn } from "@/lib/auth";

// The Auth.js `?error=` codes this gate can realistically surface, in plain,
// honest copy. The allowlist rejection (isAllowedUser → false) lands here as
// "AccessDenied".
function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "AccessDenied":
      return "That account is not on the Mission Control allowlist. Access is limited to authorized Petra staff.";
    case "Configuration":
      return "Sign-in is temporarily unavailable due to a server configuration issue.";
    default:
      return "Sign-in did not complete. Please try again.";
  }
}

async function startEntraSignIn() {
  "use server";
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // OIDC is only configured on the deployed environment; locally the gate is
  // dormant and the provider does not exist, so disable the hand-off there.
  const enabled = oidcEnabled();

  if (enabled) {
    const session = await auth();
    if (session?.user) redirect("/");
  }

  const { error } = await searchParams;
  const message = errorMessage(error);

  return (
    <main className="mc-auth">
      <section className="card">
        <Image
          src="/brand/logo-horizontal-ink.png"
          alt="Petra Lab-X"
          width={409}
          height={107}
          className="logo"
          priority
        />
        <div>
          <Kicker className="mc-auth-kicker">Mission Control</Kicker>
          <h1>Sign in</h1>
        </div>
        <p className="lede">
          The agent-operated work hub for Petra Lab-X. Access is restricted to
          authorized Petra staff.
        </p>
        {message ? (
          <div className="mc-auth-banner" role="alert">
            {message}
          </div>
        ) : null}
        <form action={startEntraSignIn} className="form">
          <button type="submit" className="mc-auth-msbtn" disabled={!enabled}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              aria-hidden="true"
              fill="currentColor"
            >
              <rect x="0" y="0" width="7" height="7" />
              <rect x="9" y="0" width="7" height="7" />
              <rect x="0" y="9" width="7" height="7" />
              <rect x="9" y="9" width="7" height="7" />
            </svg>
            Sign in with Microsoft Entra ID
          </button>
        </form>
        {enabled ? null : (
          <p className="note">Direct sign-in runs on the deployed environment.</p>
        )}
      </section>
    </main>
  );
}
