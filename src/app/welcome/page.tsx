import Image from "next/image";
import type { Metadata } from "next";

import { BrandBoundary, Kicker } from "@/components/brand";

import { WelcomeClient } from "./welcome-client";

export const metadata: Metadata = {
  title: "Welcome · PLX Mission Control",
  description:
    "Get started with Mission Control: open the app in your browser. Cursor MCP and skills are optional.",
};

export default function WelcomePage() {
  return (
    <BrandBoundary className="mc-welcome" data-testid="welcome-screen">
      <section className="mc-welcome-hero">
        <Image
          src="/brand/logo-horizontal-ink.png"
          alt="Petra Lab-X"
          width={409}
          height={107}
          className="mc-welcome-logo"
          priority
        />
        <Kicker className="mc-welcome-kicker">Mission Control</Kicker>
        <h1>Start here</h1>
        <p className="mc-welcome-lede">
          One click for most people: open Mission Control and sign in with your
          work account. No downloads, no secret files.
        </p>
        <WelcomeClient />
      </section>

      <section className="mc-welcome-secondary" aria-label="For engineers">
        <details className="mc-welcome-details" data-testid="welcome-engineers">
          <summary>For engineers</summary>
          <h2 id="when-you-pr">When you open a PR</h2>
          <ul>
            <li>
              On <strong>PLX_MC</strong>, <strong>plx-customer-portal</strong>,{" "}
              <strong>for-and-against</strong>, and <strong>skills</strong>, the
              routing job may add a Mission Control suggestion link in the Actions
              summary — open it to review the proposal. Candidate details stay in
              MC, not in GitHub.
            </li>
            <li>
              Agent PRs need <code>MC-Checkout: dsp_…</code> and a human accountable
              owner (usually <code>vince@petrasoap.com</code> until your team maps
              owners).
            </li>
            <li>
              Suggestion is on for those four repos. Confirmation and fuzzy
              auto-link remain off.
            </li>
          </ul>
          <p>
            Canonical guide:{" "}
            <a href="https://github.com/petralabx/PLX_MC/blob/main/docs/runbooks/mc-for-colleagues.md">
              docs/runbooks/mc-for-colleagues.md
            </a>
          </p>
        </details>
      </section>
    </BrandBoundary>
  );
}
