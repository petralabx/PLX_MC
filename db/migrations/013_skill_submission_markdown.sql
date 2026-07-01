-- Persist submitted SKILL.md content so approval/publish never fetches
-- arbitrary reviewer-provided URLs server-side.

ALTER TABLE skill_submissions
    ADD COLUMN IF NOT EXISTS skill_md text;
