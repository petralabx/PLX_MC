# SOP — PLX Customer Portal (customer testing)

**Audience:** Customer testers  
**Owner:** Vince · **Status:** active · **Effective:** 2026-07-22  
**Canonical version:** SOP-CT-001 v4.64

> **TL;DR** — Use the customer-facing portal SOP for safe, step-by-step testing.
> When reporting a Medium+ issue, choose one evidence method so PLX can reproduce
> the issue without an avoidable clarification round.

## Purpose

Point customer testers to the current external portal instructions without exposing
internal administration details or maintaining a duplicate procedure in Mission
Control.

This file is a **pointer summary** for the MC SOP Guide. The full procedure is
canonical in `petralabx/plx-customer-portal` on the `staging` branch.

## When to use

- Testing customer-facing portal features
- Reporting a bug or usability issue
- Adding evidence that helps PLX reproduce an issue
- Answering follow-up questions from the UAT agent

## Choose one evidence method

| Path | What to provide |
|---|---|
| A — Record with Clips | Share link + what you expected |
| B — Capture screenshot | Screenshot + what you expected |
| C — Write details | Steps + what you expected + what happened |

The form reveals only the fields for the selected method. Medium+ issues require a
complete method. Low-severity feedback can be sent without evidence.

## If PLX asks for clarification

The email explains why work is paused and links directly to your UAT ticket. Open
the ticket, answer the listed questions, and select **Submit answers**. A saved
draft does not resume work.

## Quick checklist

- [ ] Use the staging portal link supplied by PLX
- [ ] Avoid including passwords or other secrets in evidence
- [ ] Choose one complete evidence path for a Medium+ issue
- [ ] Confirm the screenshot or share link shows the relevant issue
- [ ] Submit clarification answers if PLX requests them

## Canonical source

Authoritative customer SOP (edit there, not here):

- https://github.com/petralabx/plx-customer-portal/blob/staging/docs/External-SOP.md
