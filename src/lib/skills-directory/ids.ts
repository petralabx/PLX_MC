// Shared skill-id validation. Skill ids become filesystem path segments in
// installer scripts, so reject anything that is not a plain kebab-case id.

export const SKILL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function isValidSkillId(value: string): boolean {
  return SKILL_ID_PATTERN.test(value);
}

export function assertValidSkillId(value: string): string {
  if (!isValidSkillId(value)) {
    throw new Error(`invalid skill id "${value}"`);
  }
  return value;
}
