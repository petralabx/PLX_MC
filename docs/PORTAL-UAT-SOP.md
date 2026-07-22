# SOP — PLX Customer Portal UAT

**Audience:** PLX QA/UAT testers and staff  
**Owner:** Vince · **Status:** active · **Effective:** 2026-07-22  
**Canonical version:** PLX-UAT-001 v7.93

> **TL;DR** — Use the portal repository's UAT SOP for executable customer-portal
> test cases and completion checklists. Medium+ bug-like feedback is path-first:
> choose Clips, screenshot, or written reproduction evidence before submitting.

## Purpose

Give testers one discoverable entry point to the current portal UAT procedure
while keeping the detailed test matrix in its canonical repository.

This file is a **pointer summary** for the MC SOP Guide. The full procedure is
canonical in `petralabx/plx-customer-portal` on the `staging` branch.

## When to use

- Planning or running portal UAT
- Recording pass/fail evidence against portal test cases
- Submitting a Medium+ bug or usability issue
- Responding when the UAT agent requests clarification

## Evidence paths

| Path | What the tester supplies |
|---|---|
| A — Record with Clips | Valid HTTPS Clips/share URL + Expected behavior |
| B — Capture screenshot | Screenshot + Expected behavior |
| C — Write details | Steps + Expected behavior + Actual behavior |

The form shows only the controls for the selected path. Medium+ submission remains
blocked until that path is complete and names missing items. Low severity can be
submitted without choosing a path; choosing Path C opts into all three written
fields.

## Clarification return

Complete evidence skips clarification. If questions remain, the notification
explains why work is paused and uses **Open ticket and answer questions** to return
the submitter to **PLX Portal → UAT Feedback → Your ticket**. Saving a draft does
not resume work; only **Submit answers** does.

## Quick checklist

- [ ] Use `https://staging.plxcustomer.io`
- [ ] Select the applicable feedback type and severity
- [ ] For Medium+, choose and complete one evidence path
- [ ] Verify hidden paths do not leak stale evidence
- [ ] Attach the required result evidence to the canonical UAT case
- [ ] Submit clarification answers, rather than leaving only a draft

## Canonical source

Authoritative SOP (edit there, not here):

- https://github.com/petralabx/plx-customer-portal/blob/staging/docs/UAT-SOP-Customer-Portal.md
