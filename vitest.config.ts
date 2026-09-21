import { defineConfig } from "vitest/config";
import path from "node:path";

// Regression test suite for pure calculation logic (src/lib/metrics.ts and
// similar) — no live database required. See src/lib/__tests__ for the
// tests themselves and HANDOFF.md for how this fits into the deploy
// pipeline (vercel.json's buildCommand runs this before `next build`).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
