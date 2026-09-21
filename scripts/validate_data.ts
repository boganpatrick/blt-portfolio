// Data-integrity + calc-sanity validation, run against a fresh, disposable
// local SQLite database seeded from src/db/seed.ts — never against
// production. Two purposes:
//
//   1. Catch the class of data-entry mistake that caused real production
//      bugs (a closed loan with no current_balance recorded, an
//      interest-only loan missing its flag, etc.) before they ship.
//   2. Sanity-check every property's computed metrics (PITI, DSCR, cap
//      rate, cash-on-cash, leverage) against plausible real-world ranges,
//      using the same computeMetricWarnings() logic the app itself uses to
//      flag anomalies on the dashboard — so "does the UI warn about this"
//      and "does the pipeline block on this" stay in sync automatically.
//
// This is meant to run on every commit/build (see package.json's "verify"
// script and vercel.json's buildCommand) — it never touches
// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN even if they're set in the
// environment (e.g. on Vercel), since it always points seed.ts at its own
// temp file explicitly.
//
// Exit code: non-zero on any hard failure (broken references, missing
// required fields, a metric warning) — a hard failure blocks a build that
// runs this script. Soft/info notes don't affect the exit code.

import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { computePropertyMetrics, computeMetricWarnings, type MetricWarning } from "../src/lib/metrics";
import * as schema from "../src/db/schema";

const REPO_ROOT = path.resolve(__dirname, "..");

function fail(messages: string[]): never {
  console.error(`\n❌ validate:data FAILED (${messages.length} issue${messages.length === 1 ? "" : "s"}):\n`);
  for (const m of messages) console.error(`  - ${m}`);
  console.error("");
  process.exit(1);
}

async function main() {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "rpm-validate-"));
  const dbPath = path.join(tmpDir, "validate.db");
  const dbUrl = `file:${dbPath}`;
  // The generated drizzle config must live inside the repo (not /tmp) so
  // Node's module resolution for `drizzle-kit` finds this repo's
  // node_modules — requiring it from outside the repo tree fails.
  const scratchDir = path.join(REPO_ROOT, ".validate-scratch");
  mkdirSync(scratchDir, { recursive: true });

  try {
    console.log(`Building a disposable validation database at ${dbPath} ...`);

    // 1. Push the schema (this is local/offline for a file: URL — no
    // network, no production credentials involved).
    const tmpConfigPath = path.join(scratchDir, "drizzle.config.validate.ts");
    writeFileSync(
      tmpConfigPath,
      `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ schema: "${path.join(REPO_ROOT, "src/db/schema.ts")}", out: "${path.join(tmpDir, "drizzle")}", dialect: "sqlite", dbCredentials: { url: "${dbPath}" } });\n`
    );
    execSync(`npx drizzle-kit push --config "${tmpConfigPath}" --force`, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env },
    });

    // 2. Seed it, by running the real seed.ts against this temp file —
    // deliberately overriding TURSO_DATABASE_URL/TURSO_AUTH_TOKEN so this
    // can never accidentally touch production even if those are set in the
    // calling environment (e.g. a Vercel build).
    console.log("Seeding the validation database from src/db/seed.ts ...");
    execSync("npx tsx src/db/seed.ts", {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, TURSO_DATABASE_URL: dbUrl, TURSO_AUTH_TOKEN: "" },
    });

    // 3. Run the actual checks against the freshly-seeded temp database.
    // Use Drizzle (not raw SQL) so column names come back camelCase,
    // matching computePropertyMetrics()/computeMetricWarnings()'s types —
    // raw `SELECT *` returns snake_case DB column names instead, which
    // silently produced `undefined` for every property_id on first pass.
    const client = createClient({ url: dbUrl });
    const db = drizzle(client, { schema });
    const hardFailures: string[] = [];
    const infoNotes: string[] = [];

    const props = await db.select().from(schema.properties);
    const allLoans = await db.select().from(schema.loans);
    const loanByPropertyId = new Map(allLoans.map((l) => [l.propertyId, l]));

    if (props.length === 0) hardFailures.push("properties table is empty after seeding — seed.ts may be broken.");

    // 3a. Referential integrity: every FK-ish column should point at a row
    // that actually exists. (SQLite FKs aren't enforced by default, so this
    // is the only thing that will actually catch a dangling reference.)
    const propertyIds = new Set(props.map((p) => p.id));
    for (const l of allLoans) {
      if (!propertyIds.has(l.propertyId)) hardFailures.push(`loans row ${l.id} references a nonexistent property_id ${l.propertyId}`);
    }
    const ownerships = await db.select().from(schema.propertyOwnerships);
    const allEntities = await db.select().from(schema.entities);
    const entityIds = new Set(allEntities.map((e) => e.id));
    for (const row of ownerships) {
      if (!propertyIds.has(row.propertyId)) hardFailures.push(`property_ownerships row ${row.id} references a nonexistent property_id ${row.propertyId}`);
      if (!entityIds.has(row.entityId)) hardFailures.push(`property_ownerships row ${row.id} references a nonexistent entity_id ${row.entityId}`);
    }

    // 3b. The exact class of bug that shipped: a loan that's clearly closed
    // (has an original amount) but has no current_balance recorded, which
    // every downstream calc (equity, leverage, DSCR) silently reads as $0
    // debt / cash purchase.
    for (const l of allLoans) {
      if (l.originalAmount && (l.currentBalance === null || l.currentBalance === undefined)) {
        hardFailures.push(`loans row ${l.id} (property ${l.propertyId}) has original_amount but no current_balance — will render as debt-free, likely wrong.`);
      }
    }

    // 3c. Per-property metric sanity, via the exact same computeMetricWarnings()
    // the dashboard uses — anything the UI would flag as a warning is a
    // hard failure here, since a warning generally means either a data
    // mistake or a calc regression.
    for (const p of props) {
      if (p.status === "personal_residence") continue; // excluded from the app entirely, no metrics expected
      const loan = loanByPropertyId.get(p.id);
      const metrics = computePropertyMetrics({ property: p, loan, noi: undefined });
      const warnings: MetricWarning[] = computeMetricWarnings({ property: p, loan, metrics });
      for (const w of warnings) {
        hardFailures.push(`${p.address}: [${w.field}] ${w.message}`);
      }
    }

    // 3d. Basic required-field sanity (things that should never be null on
    // a real property record).
    for (const p of props) {
      if (!p.address) hardFailures.push(`properties row ${p.id} has no address.`);
      if (!p.status) hardFailures.push(`properties row ${p.id} (${p.address}) has no status.`);
    }

    // 3e. Informational: properties with no loan at all are assumed cash
    // purchases — not a failure, just worth a note so it's visible in CI
    // logs if that ever looks surprising.
    const cashPurchases = props.filter((p) => !loanByPropertyId.has(p.id) && p.status !== "personal_residence" && p.status !== "under_contract");
    if (cashPurchases.length > 0) {
      infoNotes.push(`${cashPurchases.length} propert${cashPurchases.length === 1 ? "y has" : "ies have"} no loan on file (assumed cash purchase): ${cashPurchases.map((p) => p.address).join(", ")}`);
    }

    if (infoNotes.length > 0) {
      console.log("\nℹ Notes (not failures):");
      for (const n of infoNotes) console.log(`  - ${n}`);
    }

    if (hardFailures.length > 0) fail(hardFailures);

    console.log(`\n✅ validate:data passed — ${props.length} properties, ${allLoans.length} loans, no data/calc issues found.\n`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("validate:data crashed:", err);
  process.exit(1);
});
