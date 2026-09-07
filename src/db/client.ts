import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import path from "node:path";

// @libsql/client speaks both a local SQLite file (file:...) and a remote
// Turso database (libsql://...) through the same API, so this one client
// covers local dev (no env vars set -> falls back to the local dev.db file)
// and production (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN set, e.g. on
// Vercel) without any code branching.
const url = process.env.TURSO_DATABASE_URL ?? `file:${path.join(process.cwd(), "dev.db")}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

export const db = drizzle(client, { schema });
