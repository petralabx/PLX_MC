# External research: employee home pages, MRP/ERP dashboards, dashboard UX (2026-10-25)

Method: web search, standard mode. Microsoft Learn, NN/g and SAP pages were blocked by the session proxy,
so those citations rest on search summaries. Verify before quoting them as acceptance criteria.

## A. Employee / internal home pages

- **Lead with what needs me.** Linear Inbox Priority tab and My Issues. https://linear.app/docs/inbox
- **Consolidated to-dos with a count per source.** SAP S/4HANA My Home. https://www.sap.com/design-system/fiori-design-web/v1-148/discover/sap-products/sap-s4hana-only/s4hana-product-home-page-my-home
- **Recent and favourites as a strip, not a wall.** Atlassian Home, Notion Home. https://www.notion.com/help/home-and-my-tasks
- **Hard caps per widget.** Salesforce Lightning Home: Assistant 10, Events 5, Tasks 5. https://trailhead.salesforce.com/content/learn/modules/lightning_app_builder/lightning_app_builder_homepage
- **Role pages plus conditional visibility.** Salesforce, ServiceNow Employee Center.
- **Small per-user metric set; avoid promo cards.** Shopify Home's 2026 redesign drew complaints for burying stats under AI action items. https://community.shopify.com/t/admin-splash-page-keeps-getting-worse/637390
- **Command palette as the universal entry.** Linear ⌘K and G-then-X.

## B. MRP / ERP / manufacturing home pages

- **Business Central Role Center anatomy:** headline, Activities (cues: count tiles that drill into a filtered
  list, coloured by two thresholds), action tiles, insights, lists. Parts reflow; Microsoft advises against grouping.
  https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-designing-role-centers
- **MRPeasy widgets:** late POs, MOs ready to start, on-time %, awaiting inspection; each drills to a report. https://www.mrpeasy.com/documentation/dashboard
- **Material readiness lights per MO** (Odoo add-ons): ready, supply late, no supply.
- **Reminders only when non-zero** (NetSuite). A clean home means nothing is wrong.
- **SAP Fiori:** Overview Page for reacting across apps; tiles only for launching; notifications for urgent issues only.
- **Supervisor test:** drop any KPI that implies no next action. Pair lagging OTIF with leading indicators.

## C. UX guidelines and anti-patterns

- Length and position over area or angle (NN/g preattentive). F-pattern: most important top-left.
- Inverted pyramid and the 5-second rule; 3 to 7 primary metrics; progressive disclosure.
- Manage by exception (Oracle Alta); exception queue with why-it-appeared and one action.
- KPI tile: value, comparison, optional sparkline. (PLX Planning KpiStrip deliberately omits sparklines and arrows.)
- Tables for homogeneous rows; cards for heterogeneous items with their own action.
- Density toggles for tables only; never densify alerts.
- Colour never alone: shape and word too; 4.5:1 text and 3:1 marks in both themes.
- Floor tablets: 44 to 48 px targets, large digits, muted base with strong colour only for abnormal states.
- Anti-patterns: more than one screen, no context, vanity cumulative counts, problems hidden behind filters.

## Top recommendations adopted in the prototype

1. Row one is a role-filtered Awaiting you queue, capped at 5, each row with why and one action. Empty is one sentence.
2. Business Central role-center order: headline, cues, lists, then navigation.
3. Six cues per role, each a link to its filtered list; value colour only when short, late or contested; zero never coloured.
4. Role defaults from existing grants; hide and reorder allowed, free-form building not.
5. Caps on every list; "view all" instead of scrolling.
6. Command palette and G-then-key shortcuts; module tiles become a text index.
7. Honest data: "as of" times; "unavailable", never a false zero.
8. Phone and tablet layout with 44 px targets.
