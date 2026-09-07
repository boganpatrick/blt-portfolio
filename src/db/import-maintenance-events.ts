// Import the itemized rehab component checklists pulled from each VARE
// file's "Renovation" tab (see scripts/extract_vare_renovation.py) into
// maintenance_events — real per-line-item rehab spend with descriptions,
// not just the lump-sum rehab budget already in underwriting_models.
//
// Run with: npx tsx src/db/import-maintenance-events.ts

import fs from "node:fs";
import path from "node:path";
import { db } from "./client";
import { properties, maintenanceEvents } from "./schema";
import { eq } from "drizzle-orm";

const JSON_PATH = path.join(process.cwd(), "data/processed/maintenance/vare_renovation_items.json");

type FileEntry = {
  property_address: string;
  source_file: string;
  items: { category: string; cost: number; notes: string | null; date: string | null }[];
};

async function main() {
  if (!fs.existsSync(JSON_PATH)) {
    console.log("No data/processed/vare_renovation_items.json — run scripts/extract_vare_renovation.py first.");
    return;
  }
  const entries: FileEntry[] = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  const allProperties = await db.select().from(properties);

  let inserted = 0;
  for (const entry of entries) {
    const property = allProperties.find((p) => p.address === entry.property_address);
    if (!property) {
      console.warn(`Skipping ${entry.source_file}: no property matching "${entry.property_address}".`);
      continue;
    }

    // Idempotency: skip if this source file's events are already loaded for
    // this property (checked via a distinctive existing row rather than a
    // dedicated flag, since the table has no natural unique key).
    const existing = await db.select().from(maintenanceEvents)
      .where(eq(maintenanceEvents.propertyId, property.id));
    const alreadyLoaded = existing.some((e) => e.notes?.includes(entry.source_file));
    if (alreadyLoaded) {
      console.log(`Already imported ${entry.source_file} for ${entry.property_address} — skipping.`);
      continue;
    }

    for (const item of entry.items) {
      await db.insert(maintenanceEvents).values({
        propertyId: property.id,
        category: item.category,
        description: item.notes,
        eventDate: item.date,
        cost: item.cost,
        isCapex: true,
        notes: `From ${entry.source_file}'s Renovation tab (itemized rehab checklist — a budgeted/completed line item Patrick tracked there, not a live maintenance ticket).`,
      });
      inserted++;
    }
    console.log(`Imported ${entry.items.length} rehab line items for ${entry.property_address} from ${entry.source_file}.`);
  }

  console.log(`\nDone. ${inserted} maintenance_events rows imported.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
