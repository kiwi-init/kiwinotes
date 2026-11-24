// @hutch cli=0.29.0
// Run through `bun run <script>` (package.json), which uses the pinned Hutch.
export default {
  electrobun: {
    version: "2026.11.5",
  },
  packageManager: "bun",
  scripts: {
    // Builds the UI once and starts the app with agent control on.
    dev: "hutch electrobun prepare && bun scripts/ui-build.ts && ELECTROBUN_AGENT_CONTROL=1 hutch electrobun dev --watch",
    // Same, but the windows load from Vite's dev server (HMR).
    "dev:hmr": "bun x concurrently -k \"hutch run hmr\" \"hutch run dev\"",
    hmr: "hutch electrobun prepare && bun x vite",
    build: "hutch electrobun prepare && bun scripts/ui-build.ts && hutch electrobun build --env=stable",
  },
};
