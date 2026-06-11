-- Inbound delta cursors: one Graph deltaLink per list/library, persisted
-- between sweeps (SHAREPOINT_INTEGRATION.md §6 "Persist the deltaLink per
-- list/library between sweeps"). list_key matches config/sharepoint-schema.json
-- keys: roadmap | todos | milestones | risks | documents.

CREATE TABLE IF NOT EXISTS delta_links (
    list_key   text PRIMARY KEY,
    delta_link text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
