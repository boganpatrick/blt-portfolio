// Import PM (property manager) owner statements — the intermediate JSON
// files produced by scripts/parse_pm_statement.py from CRM Properties' and
// T&H Realty Services' raw xlsx/PDF statements — into pm_reports and
// pm_report_line_items.
//
// Each JSON file is one statement for one entity/period. This script:
//  1. Matches entity_label -> entities row (by name, tolerant of "BLT
//     Washington, LLC" vs "BLT Washington LLC" punctuation differences, and
//     of an entity that's been renamed since the statement was issued, e.g.
//     old "BLT Mohawk LLC" statements for the property now held by "BLT
//     Wildcat LLC" post-restructuring).
//  2. Matches each line item's property_label -> properties row by address,
//     tolerant of PM formatting quirks (unit suffixes, trailing city/state/
//     zip, "St." vs "St", "Dr" vs "Drive").
//  3. Matches each line item's raw_category -> normalizedCategoryId via
//     category_mappings for that PM, inserting a new mapping row (guessed
//     via keyword match, flagged for review) when one doesn't exist yet.
//
// Run with: npx tsx src/db/import-pm-reports.ts [file-or-dir ...]
// Defaults to every *.json in data/processed/.

import fs from "node:fs";
import path from "node:path";
import { db } from "./client";
import {
  entities, properties, propertyManagers, pmReports, pmReportLineItems,
  categoryMappings, normalizedCategories,
} from "./schema";
import { eq, and } from "drizzle-orm";

type ParsedStatement = {
  source_file: string;
  pm_name: string;
  entity_label: string;
  period_start: string | null;
  period_end: string | null;
  statement_date: string | null;
  summary: {
    beginning_balance?: number;
    ending_balance?: number;
    total_income?: number;
    total_expenses?: number;
    total_adjustments?: number;
    total_distribution?: number;
  };
  category_totals: { raw_category: string; statement_period: number | null; ytd: number | null }[];
  line_items: {
    property_label: string | null;
    raw_category: string;
    description: string | null;
    date: string | null;
    amount: number;
  }[];
};

function normalizeName(s: string) {
  return s.toLowerCase().replace(/[.,]/g, "").replace(/\bllc\b/g, "").replace(/\s+/g, " ").trim();
}

// Strip city/state/zip and unit suffixes so "738 S Washington St Unit 1,
// Kokomo, IN 46901" and "738 S Washington, Kokomo, IN 46901" both reduce to
// something matchable against the seed's bare street address ("738 S.
// Washington"). This is intentionally loose — a false match is caught by
// spot-checking the console warnings this script prints for anything that
// doesn't resolve.
function addressKey(s: string) {
  return s
    .split(",")[0] // drop ", City, ST zip"
    .toLowerCase()
    .replace(/\bunit\s*\d+\b/g, "")
    .replace(/\bst\.?\b/g, "st")
    .replace(/\bdr\.?\b/g, "dr")
    .replace(/\bave\.?\b/g, "ave")
    .replace(/\brd\.?\b/g, "")
    // Direction words are inconsistently present/positioned across sources
    // ("225 S Kingston" in the seed vs "225 Kingston Rd" on a PM
    // statement), so drop them entirely rather than try to align order.
    .replace(/\b[nsew]\b/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Category-guessing fallback for a raw PM wording this script hasn't seen
// mapped yet — keyword match against normalized category names, so an
// unmapped row still lands somewhere sane instead of null, but is flagged
// in the console output for Patrick to confirm/correct in category_mappings.
const GUESS_KEYWORDS: { keywords: string[]; normalizedName: string }[] = [
  { keywords: ["rent"], normalizedName: "Rent Income" },
  { keywords: ["management fee"], normalizedName: "Management Fee" },
  { keywords: ["lease", "leasing", "renewal"], normalizedName: "Leasing / Lease Renewal Fee" },
  { keywords: ["repair", "maintenance", "lock change", "sewer clean"], normalizedName: "Repairs & Maintenance" },
  { keywords: ["turnover", "make-ready", "make ready"], normalizedName: "Turnover / Make-Ready" },
  { keywords: ["lawn", "landscap"], normalizedName: "Landscaping / Lawn Care" },
  { keywords: ["pest"], normalizedName: "Pest Control" },
  { keywords: ["tree"], normalizedName: "Tree Maintenance" },
  { keywords: ["utilit"], normalizedName: "Utilities" },
  { keywords: ["supplies", "stock"], normalizedName: "Supplies" },
  { keywords: ["equipment rental"], normalizedName: "Equipment Rental" },
  { keywords: ["incentive", "gift"], normalizedName: "Tenant Incentive / Gift" },
  { keywords: ["insurance"], normalizedName: "Insurance" },
  { keywords: ["property tax", "tax"], normalizedName: "Property Tax" },
  { keywords: ["mortgage", "debt service"], normalizedName: "Mortgage / Debt Service" },
  { keywords: ["legal", "eviction", "professional"], normalizedName: "Legal / Professional Fees" },
  { keywords: ["software", "subscription"], normalizedName: "Software Subscriptions" },
  { keywords: ["bank fee"], normalizedName: "Bank Fees" },
  { keywords: ["improvement", "capex", "upgrade"], normalizedName: "Improvements / Capex" },
  { keywords: ["owner contribution", "contribution"], normalizedName: "Owner Contribution" },
  { keywords: ["owner draw", "draw", "distribution"], normalizedName: "Owner Draw / Distribution" },
  { keywords: ["m2m fee", "month-to-month fee", "month to month fee"], normalizedName: "Other Income" },
  { keywords: ["commission"], normalizedName: "Legal / Professional Fees" },
];

// Manual, Patrick-confirmed property assignments for specific line items
// that came through with no property_label at all (so matchProperty()
// below has nothing to go on) — same pattern as CONFIRMED_OVERRIDES in
// import-b2-partners-capital.ts. Matched by entity label + exact raw
// category + amount, which is deliberately narrow so this never silently
// grabs an unrelated future transaction that happens to share a category
// name.
const CONFIRMED_LINE_ITEM_OVERRIDES: { entityLabel: string; rawCategory: string; amount: number; propertyAddress: string; note: string }[] = [
  {
    entityLabel: "B2 Partners, LLC",
    rawCategory: "CommissionPaid",
    amount: 1000,
    propertyAddress: "1339 Division St",
    note: "Buyer's agent commission paid to Audra Cannon (CRM Properties) for the 1339 Division St purchase — confirmed by Patrick (2026-09-04).",
  },
];

function guessNormalizedCategory(rawCategory: string): string | null {
  const lower = rawCategory.toLowerCase();
  for (const { keywords, normalizedName } of GUESS_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return normalizedName;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  let files: string[];
  if (args.length > 0) {
    files = args.flatMap((a) =>
      fs.statSync(a).isDirectory()
        ? fs.readdirSync(a).filter((f) => f.endsWith(".json")).map((f) => path.join(a, f))
        : [a]
    );
  } else {
    const dir = path.join(process.cwd(), "data/processed");
    files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : [];
  }
  if (files.length === 0) {
    console.log("No PM statement JSON files found. Run scripts/parse_pm_statement.py first.");
    return;
  }

  const allEntities = await db.select().from(entities);
  const allProperties = await db.select().from(properties);
  const allPms = await db.select().from(propertyManagers);
  const allNormalizedCats = await db.select().from(normalizedCategories);
  const normCatByName = Object.fromEntries(allNormalizedCats.map((c) => [c.name, c]));

  const propByKey = new Map<string, typeof allProperties[number]>();
  for (const p of allProperties) propByKey.set(addressKey(p.address), p);

  function matchProperty(label: string | null) {
    if (!label) return null;
    const key = addressKey(label);
    if (propByKey.has(key)) return propByKey.get(key)!;
    // fall back to a startsWith/contains match either direction, for cases
    // like "1339 Division St." vs seed's "1339 Division St"
    for (const [pKey, prop] of propByKey) {
      if (key.startsWith(pKey) || pKey.startsWith(key)) return prop;
    }
    return null;
  }

  function matchEntity(label: string) {
    const key = normalizeName(label);
    let match = allEntities.find((e) => normalizeName(e.name) === key);
    if (match) return match;
    // Entity may have been renamed post-restructuring (BLT Mohawk LLC ->
    // BLT Wildcat LLC now owns 808 Maumee; BLT Buckeye LLC -> BLT Flats
    // LLC). A statement issued under the old name still needs to land
    // somewhere queryable, so fall back to the dissolved entity of that
    // exact old name if one exists (better than silently dropping data).
    match = allEntities.find((e) => normalizeName(e.name).includes(key) || key.includes(normalizeName(e.name)));
    return match ?? null;
  }

  // Cache of (pmId, rawCategory) -> normalizedCategoryId, seeded from
  // existing category_mappings and extended in-memory as we guess new ones.
  const existingMappings = await db.select().from(categoryMappings);
  const mappingKey = (pmId: string, raw: string) => `${pmId}::${raw.trim().toLowerCase()}`;
  const mappingCache = new Map<string, string | null>();
  for (const m of existingMappings) mappingCache.set(mappingKey(m.pmId, m.rawCategory), m.normalizedCategoryId);

  const unresolvedProperties = new Set<string>();
  const unresolvedEntities = new Set<string>();
  const guessedCategories = new Set<string>();

  let reportsImported = 0, lineItemsImported = 0;

  for (const file of files) {
    const stmt: ParsedStatement = JSON.parse(fs.readFileSync(file, "utf-8"));

    const pm = allPms.find((p) => normalizeName(p.name).includes(normalizeName(stmt.pm_name)) || normalizeName(stmt.pm_name).includes(normalizeName(p.name)));
    if (!pm) {
      console.warn(`Skipping ${file}: no property manager matching "${stmt.pm_name}" in property_managers.`);
      continue;
    }
    const entity = matchEntity(stmt.entity_label);
    if (!entity) unresolvedEntities.add(stmt.entity_label);

    if (!stmt.period_start || !stmt.period_end) {
      console.warn(`Skipping ${file}: could not determine statement period.`);
      continue;
    }

    // Idempotency: skip if we've already imported this exact (pm, entity,
    // period, sourceFile) combination, so re-running the importer after
    // adding more statements doesn't double-count.
    const already = await db.select().from(pmReports).where(
      and(
        eq(pmReports.pmId, pm.id),
        eq(pmReports.periodStart, stmt.period_start),
        eq(pmReports.periodEnd, stmt.period_end),
        eq(pmReports.sourceFile, `${stmt.source_file}::${stmt.entity_label}`)
      )
    );
    if (already.length > 0) {
      console.log(`Already imported ${file} (${stmt.entity_label}, ${stmt.period_start}..${stmt.period_end}) — skipping.`);
      continue;
    }

    const [report] = await db.insert(pmReports).values({
      pmId: pm.id,
      entityId: entity?.id ?? null,
      periodStart: stmt.period_start,
      periodEnd: stmt.period_end,
      statementDate: stmt.statement_date,
      beginningBalance: stmt.summary.beginning_balance ?? null,
      endingBalance: stmt.summary.ending_balance ?? null,
      totalIncome: stmt.summary.total_income ?? null,
      totalExpenses: stmt.summary.total_expenses ?? null,
      totalDistribution: stmt.summary.total_distribution ?? stmt.summary.total_adjustments ?? null,
      sourceFile: `${stmt.source_file}::${stmt.entity_label}`,
    }).returning();
    reportsImported++;

    for (const li of stmt.line_items) {
      let property = matchProperty(li.property_label);
      if (li.property_label && !property) unresolvedProperties.add(li.property_label);

      let overrideNote: string | null = null;
      if (!property) {
        const override = CONFIRMED_LINE_ITEM_OVERRIDES.find(
          (o) => o.entityLabel === stmt.entity_label && o.rawCategory === li.raw_category && o.amount === li.amount
        );
        if (override) {
          property = propByKey.get(addressKey(override.propertyAddress)) ?? null;
          overrideNote = override.note;
        }
      }

      const key = mappingKey(pm.id, li.raw_category);
      let normalizedCategoryId: string | null = mappingCache.has(key) ? mappingCache.get(key)! : null;
      if (!mappingCache.has(key)) {
        const guessName = guessNormalizedCategory(li.raw_category);
        if (guessName && normCatByName[guessName]) {
          normalizedCategoryId = normCatByName[guessName].id;
          await db.insert(categoryMappings).values({ pmId: pm.id, rawCategory: li.raw_category, normalizedCategoryId });
          guessedCategories.add(`${pm.name}: "${li.raw_category}" -> "${guessName}" (auto-guessed, please confirm)`);
        } else {
          guessedCategories.add(`${pm.name}: "${li.raw_category}" -> UNMAPPED (no keyword match)`);
        }
        mappingCache.set(key, normalizedCategoryId);
      }

      await db.insert(pmReportLineItems).values({
        reportId: report.id,
        propertyLabel: li.property_label,
        propertyId: property?.id ?? null,
        rawCategory: li.raw_category,
        description: overrideNote ? (li.description ? `${li.description} — ${overrideNote}` : overrideNote) : li.description,
        date: li.date,
        amount: li.amount,
        normalizedCategoryId,
      });
      lineItemsImported++;
    }

    console.log(`Imported ${file}: ${stmt.entity_label} ${stmt.period_start}..${stmt.period_end} (${stmt.line_items.length} line items)`);
  }

  console.log(`\nDone. ${reportsImported} statements, ${lineItemsImported} line items imported.`);
  if (unresolvedEntities.size) {
    console.log(`\nEntity labels that didn't match any entities row (line items still imported, entityId left null):`);
    for (const e of unresolvedEntities) console.log(`  - "${e}"`);
  }
  if (unresolvedProperties.size) {
    console.log(`\nProperty labels that didn't match any properties row (line items still imported, propertyLabel kept as free text):`);
    for (const p of unresolvedProperties) console.log(`  - "${p}"`);
  }
  if (guessedCategories.size) {
    console.log(`\nCategory mappings guessed or left unmapped this run — review in category_mappings:`);
    for (const c of guessedCategories) console.log(`  - ${c}`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
