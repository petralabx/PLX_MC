import { defineConfig, globalIgnores } from "eslint/config";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default defineConfig([
  ...coreWebVitals,
  ...typescript,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    ".venv/**",
    "docs/**",
    "starter-kit/**",
    // Vendored agentic-swarm checkout (gitignored; cloned by
    // .cursor/environment.json). Linting it breaks the preflight gate on any
    // machine with the swarm bootstrapped — CI never sees this directory.
    ".swarm/**",
  ]),
]);
