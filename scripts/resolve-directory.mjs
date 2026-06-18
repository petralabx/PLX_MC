// Resolve the Mission Control human directory from the Microsoft 365 tenant
// via Microsoft Graph (client-credentials flow). EN-003 / WS-1 requires the
// directory to be truthful — emails, roles, and departments come from the
// source of truth, never hand-typed.
//
// Usage:
//   node scripts/resolve-directory.mjs            # resolve the 6 known people
//   node scripts/resolve-directory.mjs "Full Name" ...   # resolve specific names
//
// Env (provided by the host, see .cursor/rules/credentials-and-access.mdc):
//   MICROSOFT_GRAPH_TENANT_ID, MICROSOFT_GRAPH_CLIENT_ID,
//   MICROSOFT_GRAPH_CLIENT_SECRET
//
// Output: a JSON array on stdout, one row per requested name, with the matched
// userPrincipalName / mail / jobTitle / department (or `null` matches when the
// person is not found). It does NOT write data.ts — a human folds confirmed
// identities into src/lib/mc-data/data.ts so unconfirmed people stay flagged.

const TENANT = process.env.MICROSOFT_GRAPH_TENANT_ID;
const CLIENT = process.env.MICROSOFT_GRAPH_CLIENT_ID;
const SECRET = process.env.MICROSOFT_GRAPH_CLIENT_SECRET;

// The six real people for the PLX directory (EN-003 aligned decision).
const DEFAULT_NAMES = ["Greg", "Rishi", "Ricardo", "Stephen", "Ross", "Vince"];

async function token() {
  if (!TENANT || !CLIENT || !SECRET) {
    throw new Error("Missing MICROSOFT_GRAPH_* env — cannot reach Graph.");
  }
  const body = new URLSearchParams({
    client_id: CLIENT,
    client_secret: SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function search(accessToken, name) {
  // Prefix match on displayName / givenName so a first name resolves a person.
  const filter = encodeURIComponent(
    `startswith(displayName,'${name}') or startswith(givenName,'${name}')`
  );
  const select = "displayName,givenName,surname,userPrincipalName,mail,jobTitle,department,accountEnabled";
  const url = `https://graph.microsoft.com/v1.0/users?$filter=${filter}&$select=${select}&$top=10`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`users ${res.status}: ${await res.text()}`);
  const value = (await res.json()).value ?? [];
  return value.map((u) => ({
    query: name,
    displayName: u.displayName ?? null,
    email: u.mail ?? u.userPrincipalName ?? null,
    jobTitle: u.jobTitle ?? null,
    department: u.department ?? null,
    enabled: u.accountEnabled ?? null,
  }));
}

async function main() {
  const names = process.argv.slice(2);
  const targets = names.length > 0 ? names : DEFAULT_NAMES;
  const accessToken = await token();
  const out = [];
  for (const name of targets) {
    const matches = await search(accessToken, name);
    out.push({ name, matches: matches.length ? matches : null });
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((err) => {
  process.stderr.write(`resolve-directory failed: ${err.message}\n`);
  process.exit(1);
});
