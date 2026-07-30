# Capabilities Deck — Operator Email Template

Use this template when delivering a confidential pitch microsite to PLX
operators (and optional internal reviewers). Send via the **plx-graph-mail**
skill (`cos@petrasoap.com` From unless overridden).

## When to send

After the microsite is live on `https://staging.plxcustomer.io/<slug>` and any
operator-requested content cuts are verified on that URL (never the vercel.app
git alias).

## Recipients

- **To:** accountable operator + named PLX reviewers for the meeting
- **From:** `cos@petrasoap.com`
- Confirm draft-versus-send before acting

## Subject

```text
<Brand> × Petra Lab-X — Confidential pitch + meeting guide (<Meeting date>)
```

## Body structure (required sections)

Copy the HTML skeleton below. Replace every `{{…}}` token. Keep the presentation
guide as an ordered list of deep links to section anchors on the live microsite.

### Anchor conventions (engine)

| Slide / section | Anchor |
|---|---|
| Hero | `#top` |
| Opportunity | `#opportunity` |
| Concepts overview (trinity) | `#concepts` |
| Concept deep-dive | `#{{concept.id}}` (e.g. `#concept-leave-in`) |
| Why PLX | `#why` |
| Capability (if present) | `#capability` |
| Diversification (if present) | *(no id today — add `id` before linking)* |
| Commercial / decisions | `#commercial` |
| Pricing (if present) | `#pricing` |
| Begin | `#begin` |
| Close | `#contact` |

Omit guide rows for sections the deck does not include.

### HTML skeleton

```html
<p><strong>Confidential — for PLX internal use / meeting prep.</strong></p>

<h2 style="margin:18px 0 8px;font-size:16px;">Customer</h2>
<ul>
  <li><strong>Name:</strong> {{brand}}</li>
  <li><strong>Website:</strong> <a href="{{website}}">{{website}}</a></li>
  <li><strong>LinkedIn:</strong> <a href="{{linkedin}}">{{linkedin_label}}</a></li>
  <li><strong>HQ / footprint:</strong> {{hq}}</li>
  <li><strong>Category:</strong> {{category}}</li>
  <li><strong>Other:</strong> {{other_business_info}}</li>
</ul>

<h2 style="margin:18px 0 8px;font-size:16px;">Meeting</h2>
<ul>
  <li><strong>Date:</strong> {{meeting_date}}</li>
  <li><strong>Attendees (customer):</strong> {{customer_attendees}}</li>
  <li><strong>PLX:</strong> {{plx_attendees}}</li>
  <li><strong>Desired decisions:</strong> {{decisions_summary}}</li>
</ul>

<h2 style="margin:18px 0 8px;font-size:16px;">Opportunity synopsis</h2>
<p>{{opportunity_synopsis}}</p>

<h2 style="margin:18px 0 8px;font-size:16px;">Presentation</h2>
<p>
  Live confidential deck (staging):
  <a href="https://staging.plxcustomer.io/{{slug}}">https://staging.plxcustomer.io/{{slug}}</a>
</p>
<p>{{presentation_caveats}}</p>

<h2 style="margin:18px 0 8px;font-size:16px;">Presentation guide</h2>
<p>Open each link to jump to that section of the deck:</p>
<ol>
  <!-- One <li> per included section, in deck scroll order. Example: -->
  <li><a href="https://staging.plxcustomer.io/{{slug}}#top">Hero</a> — {{hero_one_liner}}</li>
  <li><a href="https://staging.plxcustomer.io/{{slug}}#opportunity">The opportunity</a> — {{opportunity_one_liner}}</li>
  <li><a href="https://staging.plxcustomer.io/{{slug}}#concepts">The white space / concepts</a> — {{concepts_one_liner}}</li>
  <!-- concept deep-dives, why, commercial, begin, close … -->
</ol>

<h2 style="margin:18px 0 8px;font-size:16px;">PLX contact</h2>
<p>{{plx_contact_name}} · <a href="mailto:{{plx_contact_email}}">{{plx_contact_email}}</a></p>
```

## Validate before send (plx-graph-mail)

1. From = `cos@petrasoap.com` (unless Vince overrode)
2. No `*-git-staging-*.vercel.app` URLs
3. Every presentation link uses `https://staging.plxcustomer.io/<slug>`
4. Guide links match sections that actually exist on the live page
5. No invented pricing, volumes, certifications, or finished-product claims

## PDF archive + attachment

Per [ARCHIVE.md](ARCHIVE.md), every delivery **must** upload the print-clean PDF
to the customer SharePoint `08-Marketing & Brand` folder (or documented
fallback). In the email **Presentation** section include:

- Live microsite URL
- PDF archive SharePoint/OneDrive web URL

Optionally attach the same PDF to the Graph send when size allows. Prefer
regenerating the PDF after any content cut before archiving or attaching.
