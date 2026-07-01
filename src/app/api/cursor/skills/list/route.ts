import { cursorRoute } from "@/lib/mcp/route";
import {
  createSkillsSource,
  listSkillCatalog,
  readCompanySkillsAllowlist,
} from "@/lib/skills-directory";

export const GET = cursorRoute("mc_skills_list", async () => {
  const allowlist = readCompanySkillsAllowlist();
  return { data: await listSkillCatalog(allowlist, createSkillsSource()) };
});
