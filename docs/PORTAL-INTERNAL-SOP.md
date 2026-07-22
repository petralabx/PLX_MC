# SOP — PLX Customer Portal (internal operations)

**Audience:** PLX staff and system administrators  
**Owner:** Vince · **Status:** active · **Effective:** 2026-07-22  
**Canonical version:** SOP-CT-002 v8.06

> **TL;DR** — Use the portal repository's Internal SOP for staff workflows,
> administration, API behavior, integrations, security, deployment, and operational
> verification. This page is a discovery pointer, not a replacement procedure.

## Purpose

Help staff find the current operating instructions for the PLX Customer Portal
without copying a second, drifting SOP into Mission Control.

This file is a **pointer summary** for the MC SOP Guide. The full procedure is
canonical in `petralabx/plx-customer-portal` on the `staging` branch.

## When to use

- Operating or administering the customer portal
- Verifying portal routes, APIs, permissions, integrations, or staging deployments
- Testing the UAT feedback workflow as staff
- Investigating structured feedback intake or clarification delivery

## Current guided-evidence workflow

For Medium+ bug-like feedback, the submitter chooses one complete path:

| Path | Required evidence |
|---|---|
| A — Record with Clips | Valid HTTPS Clips/share URL + Expected behavior |
| B — Capture screenshot | Screenshot + Expected behavior |
| C — Write details | Steps + Expected behavior + Actual behavior |

Low severity does not require evidence unless the submitter chooses Path C.
Complete evidence skips agent clarification. If clarification is required, the
email returns the submitter to the portal UAT feedback ticket.

## Quick checklist

- [ ] Confirm you are using the canonical `staging` SOP
- [ ] Follow the role and route-specific procedure in the source document
- [ ] Verify Medium+ intake fails closed when evidence is incomplete
- [ ] Keep customer clarification links on customer-facing ticket routes
- [ ] Record test evidence before changing task or ticket status

## Canonical source

Authoritative SOP (edit there, not here):

- https://github.com/petralabx/plx-customer-portal/blob/staging/docs/Internal-SOP.md
