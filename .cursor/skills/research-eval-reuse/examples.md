# Example: chat surface before a custom renderer

## Problem frame

Need a production chat transcript UI in the Next.js portal, thin adapter only,
RBAC + capability ∩ AgentVersion, dual-run unchanged, no intake rewrite.

## Candidates

| name | source | fit | risks |
|---|---|---|---|
| assistant-ui | github.com/assistant-ui/assistant-ui | high — React/Next, adapter-shaped | runtime extras must stay allow-listed |
| vercel/ai-sdk ui | github.com/vercel/ai | med — already in stack, more than a transcript | easy to pull in extra AI SDK surface |
| custom transcript | n/a | high control | ownership cost, a11y, streaming edge cases |

## Recommendation

**adapt**

Reuse assistant-ui behind a thin portal adapter. It matches the current
assistant-ui path and is at least as maintained as a custom renderer would be
on day one. Do not take its optional tool-execution or unrestricted markdown
HTML. Keep message send/receive in existing portal APIs.

Non-goals: no new dual-run path, no intake-engine rewrite, no extra agent
capabilities until AgentVersion + RBAC intersection allows them.

## Next concrete step

Spike a thin adapter that mounts assistant-ui against the existing message
API, with markdown/HTML and tool execution on an allow-list, then stop for
review before any product wiring.
