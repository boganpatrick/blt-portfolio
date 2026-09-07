// One-off script to insert (or update) a login account. Not part of the
// normal seed.ts pipeline since it handles a secret (the password) that
// shouldn't live in seed.ts's source.
//
// Usage: node scripts/seed_user.mjs <username> <plaintext-password>
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from env if set (Turso),
// otherwise falls back to the local dev.db file.

import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";
import path from "node:path";

const [, , username, password] = process.argv;
if (!username || !password) {
  console.error("Usage: node scripts/seed_user.mjs <username> <password>");
  process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL ?? `file:${path.join(process.cwd(), "dev.db")}`;
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(authToken ? { url, authToken } : { url });

const passwordHash = await bcrypt.hash(password, 12);
const id = crypto.randomUUID();

await client.execute({
  sql: `INSERT INTO users (id, username, password_hash, display_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, failed_attempts = 0, locked_until = NULL`,
  args: [id, username.toLowerCase().trim(), passwordHash, username],
});

console.log(`User "${username}" set on ${url}.`);
