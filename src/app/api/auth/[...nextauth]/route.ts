// Auth.js endpoints (sign-in, callback, session, sign-out). These are
// framework-owned handlers with their own envelope/redirect semantics — the
// one deliberate exception to the shared route wrapper.

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
