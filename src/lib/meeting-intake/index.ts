// Barrel for the meeting-intake module (EN-004 / WS-4). Import pure helpers and
// types through here. The reactive triage store and its React hook are separate
// imports (mirroring mc-data): `@/lib/meeting-intake/store` and `.../hooks`. The
// in-tenant Azure extractor (`./extract`) is SERVER-ONLY and imported directly
// by the server capture path / tests, never through this client-safe barrel.
export * from "./types";
export * from "./flag";
export * from "./vtt";
export * from "./adapters";
export * from "./draft";
export * from "./register";
