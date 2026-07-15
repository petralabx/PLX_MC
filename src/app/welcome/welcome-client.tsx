"use client";

import Link from "next/link";
import { useState } from "react";

const MCP_URL = "https://mc.plxcustomer.io/api/cursor/mcp";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function WelcomeClient() {
  const [copied, setCopied] = useState(false);

  async function onCopyUrl() {
    const ok = await copyText(MCP_URL);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mc-welcome-ctas" data-testid="welcome-ctas">
      <Link className="mc-welcome-cta mc-welcome-cta-primary" href="/">
        Open Mission Control
      </Link>
      <p className="mc-welcome-hint">
        Most colleagues only need that button. Sign in with your work Microsoft
        account — you&apos;re done.
      </p>

      <details className="mc-welcome-details">
        <summary>I use Cursor with AI agents (optional)</summary>

        <section className="mc-welcome-card" aria-labelledby="connect-cursor-heading">
          <h2 id="connect-cursor-heading">Connect Cursor</h2>
          <ol className="mc-welcome-steps">
            <li>
              Ask Vince (or your admin) to add you to the team PLX-MC Cursor MCP —
              they give you the API key. You should not hunt for secrets yourself.
            </li>
            <li>
              In Cursor, open{" "}
              <a href="https://cursor.com/agents" rel="noreferrer">
                cursor.com/agents
              </a>{" "}
              (or Cursor Settings → MCP) and add a server.
            </li>
            <li>
              Paste the URL below with <strong>Copy</strong>.{" "}
              <strong>Do not open this URL in Chrome/Edge</strong> — it is not a
              website; a browser tab will look broken on purpose.
            </li>
          </ol>
          <label className="mc-welcome-label" htmlFor="mcp-url">
            MCP URL (copy into Cursor only)
          </label>
          <div className="mc-welcome-copy-row">
            <code id="mcp-url">{MCP_URL}</code>
            <button type="button" onClick={() => void onCopyUrl()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mc-welcome-hint">
            Headers / keys stay in team Cursor MCP config — never paste secrets
            into email or this page.
          </p>
        </section>

        <section className="mc-welcome-card" aria-labelledby="skills-heading">
          <h2 id="skills-heading">Company skills</h2>
          <p>
            Skills are files Cursor agents use on your laptop. Easiest path on
            Windows: download the installer and double-click it — it clones what
            it needs and runs the install. No API keys, no folder hunting.
          </p>
          <a
            className="mc-welcome-cta"
            href="https://github.com/petralabx/PLX_MC/blob/main/scripts/Install-Company-Skills.cmd"
            rel="noreferrer"
          >
            Open Install-Company-Skills.cmd
          </a>
          <p className="mc-welcome-hint">
            On GitHub: click the raw/download control (or “Download raw file”),
            save the <code>.cmd</code>, then double-click. Needs Git for Windows
            once. After it finishes, fully quit Cursor and reopen.
          </p>
          <p className="mc-welcome-hint">
            Prefer Vince to run it with you? Book 10 minutes — same outcome.
          </p>
        </section>
      </details>
    </div>
  );
}
