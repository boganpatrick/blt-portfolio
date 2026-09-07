// Separate drizzle-kit config for pushing the schema to the production Turso
// database (as opposed to drizzle.config.ts, which targets the local dev.db
// file). Run with: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx drizzle-kit push --config drizzle.config.turso.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
});
