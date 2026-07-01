-- PLX Skills Directory Phase 4 P2 — skill submission queue.

CREATE TABLE IF NOT EXISTS skill_submissions (
    id              text PRIMARY KEY,
    skill_id        text NOT NULL,
    title           text NOT NULL,
    description     text NOT NULL DEFAULT '',
    submitter_email text NOT NULL,
    repo_url        text,
    content_url     text,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    notes           text,
    review_comment  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skill_submissions_status_idx ON skill_submissions (status);
CREATE INDEX IF NOT EXISTS skill_submissions_skill_id_idx ON skill_submissions (skill_id);
