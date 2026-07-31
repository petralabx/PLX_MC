# Capabilities Deck — Pitch Archive (SharePoint + Portal)

Every capabilities-deck delivery produces two durable artifacts:

1. **Live microsite** — `https://staging.plxcustomer.io/<slug>` (code-deployed)
2. **Print-clean PDF** — archived to the customer SharePoint folder (mandatory)

## Mandatory PDF archive (every run)

After the print-clean PDF is verified (and before or with operator email):

1. Upload the PDF to the PLXCUSTOMERS document library under:
   ```text
   Customer Documents/{CustomerCode - CustomerName}/08-Marketing & Brand/
   ```
   Filename convention:
   ```text
   {Brand}-Petra-Lab-X-Capabilities-{YYYY-MM-DD}.pdf
   ```
2. Prefer app-only Graph (`Sites.ReadWrite.All` / `Files.ReadWrite.All`) via
   `. $HOME/.secrets-env.staging.ps1` + Graph PUT to the drive item path.
   Fallback: write to Vince OneDrive `CursorInbox` and note that staff should
   move it into the customer folder.
3. Put the SharePoint (or OneDrive) web URL in the operator email body under
   **Presentation** as “PDF archive”.
4. If the customer folder does not exist yet, create
   `{Code - Name}/08-Marketing & Brand/` (or the closest existing Marketing /
   Brand path) — do not skip the archive step silently.

This step is part of **Done**. A deck that was emailed without an archived PDF
is incomplete.

## Pitch library on the customer record (shipped)

After the PDF archive, register the delivery in the portal **Pitch library**
(`CustomerPitch` / `app_customer_pitch`):

- **Admin:** `/admin/customers/[id]` → Pitch library card (New pitch / edit /
  Open live / Open PDF / Mark superseded)
- **PD pipeline:** `/mrp/project-development` card + drawer pitch strip
- **Operator checklist + API/script:** [PITCH-LIBRARY.md](PITCH-LIBRARY.md)

Do not skip registration — a deck archived only to SharePoint is still
incomplete for staff workflows.
