// Import B2 Partners LLC's QuickBooks transaction export into
// capital_contributions, matching each row to a property (by memo keyword)
// and to a stack type (acquisition vs rehab, by QBO account), and flagging
// rows that are unclassified/uncategorized in QBO so Patrick has a concrete
// cleanup list rather than a vague "some transactions need posting."
//
// Run with: npx tsx src/db/import-b2-partners-capital.ts

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { db } from "./client";
import { entities, properties, owners, capitalContributions } from "./schema";
import { eq } from "drizzle-orm";

const CSV_PATH = path.join(process.cwd(), "data/raw/B2_Partners_LLC_Transaction_List_by_Date.csv");

// property address -> keywords to match in the QBO memo text
const PROPERTY_KEYWORDS: { address: string; keywords: string[] }[] = [
  { address: "2000 S Buckeye", keywords: ["buckeye"] },
  { address: "4076 S 450 E", keywords: ["hemlock"] },
  { address: "225 S Kingston", keywords: ["kingston"] },
  { address: "1339 Division St", keywords: ["division"] },
];

function classifyStack(account: string | undefined): "acquisition" | "rehab" | null {
  if (!account) return null;
  if (account.startsWith("1100 Buildings")) return "acquisition";
  if (account.startsWith("1500 Construction in Progress")) return "rehab";
  return null;
}

function matchProperty(memo: string | undefined): string | null {
  if (!memo) return null;
  const lower = memo.toLowerCase();
  for (const { address, keywords } of PROPERTY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return address;
  }
  return null;
}

// Manual, Patrick-confirmed overrides for specific transactions QBO hasn't
// categorized, keyed by a distinctive Name and/or memo substring (checked
// against "<name> <memo>" lowercased). Applied after the normal
// classification above, only when it left a gap. Each one exists because
// Patrick pointed at a specific transaction and said what it actually is —
// not a guess, so keep the citation/attribution in the note.
const CONFIRMED_OVERRIDES: { textIncludes: string; stackType: "acquisition" | "rehab"; propertyAddress: string; note: string }[] = [
  {
    textIncludes: "wire 35034 for division closing",
    stackType: "acquisition",
    propertyAddress: "1339 Division St",
    note: "QBO has no Split/account for this row, but it's the $136,042.72 wire on 1339_Division_Noblesville_ALTA_settlement_20251001.pdf's \"Balance Due FROM Buyer\" line — confirmed acquisition cost, per Patrick (2026-09-01), even though it's still uncategorized in QuickBooks itself.",
  },
  {
    textIncludes: "gmb design & contracting",
    stackType: "rehab",
    propertyAddress: "1339 Division St",
    note: "GMB Design & Contracting check, confirmed by Patrick (2026-09-01) as 1339 Division rehab labor.",
  },
  {
    // Deliberately specific to Check 8005 ($4,000) — Check 8006 ($700,
    // 04/14/2026) is also a "Cesario Lopez" roofing memo but posts to
    // Lawn & Landscaping, not the rehab-stack account, and Patrick didn't
    // address it, so it's left alone rather than swept in by a looser match.
    textIncludes: "8005 check; roofing, cesario",
    stackType: "rehab",
    propertyAddress: "1339 Division St",
    note: "Cesario Lopez roofing check ($4,000), confirmed by Patrick (2026-09-01) as 1339 Division rehab. (Not the same as the $3,600 Cesario Lopez Ramirez check in BLT_Partners_LLC_Transaction_List_by_Date.csv — Patrick confirmed that separate one, a different entity's checking account this importer doesn't touch, is for 1139 Division St; see maintenance_events for that one instead. A third, ~$3,000 Cesario Lopez transaction for 1611 S. Washington is expected but hasn't shown up in any file provided yet.)",
  },
  {
    // Exact-match-only memo ("Flooring", nothing else) — checked it's the
    // only row in the CSV with that word so this is safe to key on alone.
    textIncludes: "flooring",
    stackType: "rehab",
    propertyAddress: "1339 Division St",
    note: "Generic \"Flooring\" memo, no vendor named — confirmed by Patrick (2026-09-01) as 1339 Division rehab.",
  },
];

// Direct-vendor keyword list for the remainder of the "$60k of rehab spend
// with no property named in the memo" pile (Lowe's, Home Depot, Menards,
// Amazon, Wayfair, Habitat ReStore, etc.) — retail/materials purchases, as
// opposed to a contractor's own invoice or labor check. Per Patrick
// (2026-09-01): "if it's lowes or home depot or any other direct vendor,
// put that with 1339" — 1339 Division was the active rehab project this
// spending window covers. GMB Design & Contracting and the $4,000 Cesario
// Lopez check used to be excluded here as "not direct-vendor, don't guess"
// — Patrick has since confirmed both are 1339 Division too (see
// CONFIRMED_OVERRIDES above), and so is the generic "Flooring" line item
// ($2,940.32, no vendor name given) — so as of this pass every transaction
// in the original $60,432 pile has a property.
const DIRECT_VENDOR_KEYWORDS = [
  "lowe's", "lowes", "home depot", "menard", "mnrd", "amazon", "wayfair",
  "habitat", "restore", "asset recycling", "boone county ha", "dc sports cards",
  "west washinton", "roofing materials",
];
function matchDirectVendorRehab(name: string, memo: string): boolean {
  const text = `${name} ${memo}`.toLowerCase();
  return DIRECT_VENDOR_KEYWORDS.some((k) => text.includes(k));
}

function matchContributor(account: string | undefined): "mike" | "household" | null {
  if (!account) return null;
  if (account.includes("Mike")) return "mike";
  if (account.includes("P&G")) return "household";
  return null;
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n");
  // Header row ("Date,Transaction type,...") is line 5 (index 4) in this export format.
  const headerIdx = lines.findIndex((l) => l.startsWith("Date,Transaction type"));
  const csvBody = lines.slice(headerIdx).join("\n");
  const records: Record<string, string>[] = parse(csvBody, { columns: true, skip_empty_lines: true, relax_column_count: true });

  const [b2] = await db.select().from(entities).where(eq(entities.name, "B2 Partners LLC"));
  if (!b2) throw new Error("B2 Partners LLC entity not found — run seed.ts first.");
  const [mike] = await db.select().from(owners).where(eq(owners.name, "Mike Bogan"));
  const [household] = await db.select().from(owners).where(eq(owners.name, "Bogan-Rhineberger Household"));
  const allProps = await db.select().from(properties);
  const propByAddress = Object.fromEntries(allProps.map((p) => [p.address, p]));

  let inserted = 0, skipped = 0;
  for (const row of records) {
    const dateRaw = row["Date"];
    if (!dateRaw || dateRaw === "TOTAL" || !/^\d{2}\/\d{2}\/\d{4}$/.test(dateRaw)) { skipped++; continue; }
    const amountRaw = (row["Amount"] ?? "").replace(/,/g, "").replace(/"/g, "").trim();
    const amount = parseFloat(amountRaw);
    if (Number.isNaN(amount)) { skipped++; continue; }
    // Only care about the operating checking account activity, not mortgage
    // sub ssccounts or the property-management clearing account for this pass.
    const accountFull = row["Account full name"] ?? "";
    if (!accountFull.startsWith("1010 Checking")) { skipped++; continue; }

    const split = (row["Split"] ?? "").trim();
    const memo = row["Memo"] ?? "";
    const name = row["Name"] ?? "";
    const [mm, dd, yyyy] = dateRaw.split("/");
    const isoDate = `${yyyy}-${mm}-${dd}`;

    let stackType = classifyStack(split);
    let propertyAddress = matchProperty(memo);
    let confirmedNote: string | null = null;

    const nameAndMemo = `${name} ${memo}`.toLowerCase();
    const override = CONFIRMED_OVERRIDES.find((o) => nameAndMemo.includes(o.textIncludes));
    if (override) {
      stackType = override.stackType;
      propertyAddress = override.propertyAddress;
      confirmedNote = override.note;
    } else if (stackType === "rehab" && !propertyAddress && matchDirectVendorRehab(name, memo)) {
      propertyAddress = "1339 Division St";
      confirmedNote = "Unmatched in QBO (no property tagged), but it's a direct-vendor/materials purchase (Lowe's, Home Depot, Amazon, Habitat ReStore, etc.) from the window when 1339 Division was the active rehab project — assigned there per Patrick (2026-09-01).";
    }

    const property = propertyAddress ? propByAddress[propertyAddress] : undefined;
    const contributorKey = matchContributor(split);
    const contributorOwnerId = contributorKey === "mike" ? mike?.id : contributorKey === "household" ? household?.id : undefined;

    // A transaction "needs QBO cleanup" if it has no Split/account category
    // at all (Patrick's own words: "some transactions need categorized and
    // posted"), OR if it's clearly a property-linked closing/acquisition
    // cost but wasn't posted to 1100 Buildings. Still true even for the
    // confirmed overrides above — Patrick confirmed what the app should
    // *show*, but QBO itself hasn't been updated to match.
    const looksLikeAcquisitionCost = /closing/i.test(memo) && amount < 0;
    const needsQboCleanup = split === "" || (looksLikeAcquisitionCost && stackType !== "acquisition");

    await db.insert(capitalContributions).values({
      entityId: b2.id,
      propertyId: property?.id ?? null,
      date: isoDate,
      stackType,
      contributorOwnerId: contributorOwnerId ?? null,
      amount,
      memo: confirmedNote ? `${memo} — ${confirmedNote}` : memo,
      qboAccount: split || null,
      needsQboCleanup,
      sourceFile: "B2_Partners_LLC_Transaction_List_by_Date.csv",
    });
    inserted++;
  }

  console.log(`Imported ${inserted} B2 Partners checking-account transactions into capital_contributions (${skipped} rows skipped: totals/headers/non-checking).`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
