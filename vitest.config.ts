import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js needs tsconfig `jsx: preserve`; the test transform must compile
  // JSX itself (rolldown/oxc ignores the tsconfig preserve setting otherwise).
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // next-auth imports "next/server" extensionless, which Node's resolver
      // (used by vitest) rejects; Next's own bundler tolerates it.
      "next/server": "next/server.js",
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Process next-auth through the vite pipeline so the alias above applies
    // to its extensionless "next/server" import.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
  },
});
