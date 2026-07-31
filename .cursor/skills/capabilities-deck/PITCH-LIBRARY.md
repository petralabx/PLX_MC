# Capabilities Deck — Register CustomerPitch (Pitch library)

After the SharePoint PDF archive step, register the delivery on the customer's
**Pitch library** so staff can open the live deck and PDF from the admin customer
record and from the PD pipeline card/drawer.

> **Mandatory:** A deck is not **Done** until both the PDF is archived **and** a
> `CustomerPitch` row exists for the customer (or is updated in place).

## When to run

Immediately after [ARCHIVE.md](ARCHIVE.md) step 3 (SharePoint web URL confirmed)
and before or with the operator email in [EMAIL.md](EMAIL.md).

## Fields to capture

| Field | Source |
|---|---|
| `title` | e.g. `{Brand} · Capabilities & second-source path` |
| `liveUrl` | `https://staging.plxcustomer.io/<slug>` |
| `sharePointUrl` | Archived PDF web URL under `08-Marketing & Brand` |
| `meetingDate` | `YYYY-MM-DD` (optional but recommended) |
| `status` | `PRESENTED` after the meeting; `READY` before; `DRAFT` while building |
| `synopsis` | Optional one-line opportunity summary |
| `projectId` | Optional gold `Project.id` when linking to a PD pipeline card |

Status flow: `DRAFT → READY → PRESENTED → SUPERSEDED`. Mark older decks
`SUPERSEDED` when a newer pitch replaces them.

## Option A — Admin UI (preferred when available)

1. Open **`/admin/customers/[id]`** as STAFF+.
2. Scroll to the **Pitch library** card (above Projects).
3. Click **New pitch** and fill title, status, meeting date, live URL, SharePoint
   PDF URL, optional synopsis and project link.
4. Save; confirm **Open live** and **Open PDF** work from the row actions.
5. If superseding an older deck, **Mark superseded** on the prior row.

## Option B — Admin API (session auth)

Requires a STAFF+ browser session on staging (NextAuth cookie).

**List pitches (discover ids):**

```http
GET /api/admin/customers/{customerId}/pitches
Cookie: next-auth.session-token=…
```

**Create (upsert manually by checking `liveUrl` first):**

```http
POST /api/admin/customers/{customerId}/pitches
Content-Type: application/json
Cookie: next-auth.session-token=…

{
  "title": "Everist · Capabilities & second-source path",
  "liveUrl": "https://staging.plxcustomer.io/everist",
  "sharePointUrl": "https://petrasoap.sharepoint.com/sites/PLXCUSTOMERS/Shared%20Documents/Customer%20Documents/Everist/08-Marketing%20%26%20Brand/Everist-Petra-Lab-X-Capabilities-2026-07-16.pdf",
  "meetingDate": "2026-07-16",
  "status": "PRESENTED",
  "synopsis": "Second-source path + two concept sample lanes"
}
```

**Update existing pitch:**

```http
PATCH /api/admin/customers/{customerId}/pitches/{pitchId}
Content-Type: application/json

{ "status": "PRESENTED", "meetingDate": "2026-07-16" }
```

**Mark superseded:**

```http
PATCH /api/admin/customers/{customerId}/pitches/{pitchId}
Content-Type: application/json

{ "status": "SUPERSEDED" }
```

Resolve `{customerId}` from the admin customer detail URL or
`GET /api/admin/customers?search=…`.

## Option C — Headless upsert script (DATABASE_URL)

When UI/API session auth is awkward from an agent run, use the repo helper
(after `. $HOME/.secrets-env.staging.ps1`):

```powershell
node .cursor/skills/capabilities-deck/register-customer-pitch.mjs `
  --customer "Everist" `
  --title "Everist · Capabilities & second-source path" `
  --live-url "https://staging.plxcustomer.io/everist" `
  --sharepoint-url "https://petrasoap.sharepoint.com/sites/PLXCUSTOMERS/Shared%20Documents/Customer%20Documents/Everist/08-Marketing%20%26%20Brand/Everist-Petra-Lab-X-Capabilities-2026-07-16.pdf" `
  --meeting-date 2026-07-16 `
  --status PRESENTED
```

Idempotent on `(customer, liveUrl)`: updates title/URLs/date/status if the row
already exists. Skips with a log if the customer name is not found.

Everist reference seed (same locked values): `portal/tmp/seed-everist-pitch.mjs`.

## Verification checklist

- [ ] Customer detail **Pitch library** lists the new row with correct status badge
- [ ] **Open live** opens the microsite (200, no login)
- [ ] **Open PDF** opens the SharePoint archived file
- [ ] PD pipeline (`/mrp/project-development`) card for a linked customer shows
      the pitch strip (project-linked pitch, else latest **Presented** fallback)
- [ ] Drawer shows synopsis + **View on customer** link
- [ ] Prior deck marked **SUPERSEDED** when applicable

## References

- Project spec: `docs/projects/pitch-library/README.md`
- API schemas: `portal/src/lib/api-schemas/admin-content.ts` (`AdminCustomerPitch*`)
- OpenAPI: admin-content domain (`listAdminCustomerPitch`, etc.)
- Table: `app_customer_pitch` (Prisma `CustomerPitch`)
