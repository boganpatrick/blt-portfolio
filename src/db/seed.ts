// Seed the DB with the real BLT portfolio structure, as known as of
// 2026-08-30 from Patrick's documents + his summer-2026 restructuring notes.
//
// This is a foundation seed, not a full historical import: it captures
// current entity/property/loan/PM-assignment state accurately, but does NOT
// yet import full PM statement history, QBO transactions, or lease detail —
// those come next once Patrick confirms this structure is right.

import { db } from "./client";
import {
  owners, entities, entityOwnerships, properties, propertyOwnerships,
  propertyOwnerStakes, loans, propertyManagers, propertyPmAssignments,
  normalizedCategories, categoryMappings, underwritingModels, units, leases,
  maintenanceEvents,
} from "./schema";

async function main() {
  console.log("Seeding BLT Portfolio Manager...");

  // ---------- Owners ----------
  const [household] = await db.insert(owners).values({
    name: "Bogan-Rhineberger Household",
    isHousehold: true,
    notes: "Patrick Bogan + Gina Rhineberger, tracked as one combined owner everywhere except B2 Partners LLC.",
  }).returning();

  const [mike] = await db.insert(owners).values({
    name: "Mike Bogan",
    isHousehold: false,
    notes: "Patrick's brother. Capital Partner in B2 Partners LLC (50%).",
  }).returning();

  // ---------- Entities ----------
  const [personal] = await db.insert(entities).values({
    name: "Personal",
    entityType: "Personal",
    notes: "Properties held personally, not in an LLC.",
  }).returning();

  const [bltPartners] = await db.insert(entities).values({
    name: "BLT Partners LLC",
    entityType: "LLC",
    taxStatus: "S-corp",
    formedDate: "2023-01-06",
    managingMember: "Patrick Bogan",
    quickbooksSetUp: true,
    quickbooksAccountName: "BLTPartnersLLC",
  }).returning();

  const [bltBuckeye] = await db.insert(entities).values({
    name: "BLT Buckeye LLC",
    entityType: "LLC",
    taxStatus: "S-corp",
    formedDate: "2024-07-07",
    dissolvedDate: "2026-04-17", // property quitclaimed out to Patrick & Gina personally this date, per recorded deed
    managingMember: "Patrick Bogan",
    quickbooksSetUp: true,
    quickbooksAccountName: "BLTBuckeyeLLC",
    notes: "Property (110-112 S. Buckeye St) quitclaimed to Patrick & Gina personally on 4/17/2026, then quitclaimed same-day into BLT Flats LLC. Both deeds recorded 4/29/2026, Howard County.",
  }).returning();

  const [bltFlats] = await db.insert(entities).values({
    name: "BLT Flats LLC",
    entityType: "LLC",
    taxStatus: "Partnership",
    formedDate: "2026-03-16", // per Operating Agreement effective date
    managingMember: "Patrick Bogan",
    quickbooksSetUp: false,
    notes: "Operating Agreement effective 3/16/2026, 50% Patrick Bogan / 50% Gina Rhineberger (Voting Rights §4.9, Units §7.1). Received 110-112 S. Buckeye St via quitclaim 4/17/2026 (recorded 4/29/2026), routed through Patrick & Gina personally on the way out of BLT Buckeye LLC. Not yet set up in QuickBooks.",
  }).returning();

  const [bltWashington] = await db.insert(entities).values({
    name: "BLT Washington LLC",
    entityType: "LLC",
    taxStatus: "S-corp",
    formedDate: "2024-11-12",
    managingMember: "Patrick Bogan",
    quickbooksSetUp: true,
    quickbooksAccountName: "BLTWashingtonLLC",
  }).returning();

  const [bltMohawk] = await db.insert(entities).values({
    name: "BLT Mohawk LLC",
    entityType: "LLC",
    taxStatus: "S-corp",
    formedDate: "2024-11-12",
    managingMember: "Patrick Bogan",
    quickbooksSetUp: true,
    quickbooksAccountName: "BLTMohawkLLC",
  }).returning();

  const [bltWildcat] = await db.insert(entities).values({
    name: "BLT Wildcat LLC",
    entityType: "LLC",
    taxStatus: "Partnership",
    formedDate: "2026-03-16", // per Operating Agreement effective date, same as BLT Flats
    managingMember: "Patrick Bogan",
    quickbooksSetUp: false,
    notes: "Received 808 Maumee via quitclaim 4/17/2026 (recorded 4/29/2026), routed through Patrick & Gina personally on the way out of BLT Mohawk LLC. Will also hold 615 Cherry once that purchase closes (~9/17/2026). Not yet set up in QuickBooks.",
  }).returning();

  const [b2Partners] = await db.insert(entities).values({
    name: "B2 Partners LLC",
    entityType: "LLC",
    formedDate: "2025-07-03",
    managingMember: "Patrick Bogan",
    quickbooksSetUp: true,
    quickbooksAccountName: "B2PartnersLLC",
    notes: "Mike Bogan (Capital Partner, 50%, funds Acquisition Cash) + Patrick & Gina (Operating Partners, 25%/25% combined 50%, fund Rehab Cash). Stack-based economics (Acquisition Stack / Rehab Stack) apply per-property until that property's first Refinance, after which distributions are a flat 50/25/25 split. Self-management fee 8% of gross rents if self-managed.",
  }).returning();

  // ---------- Entity ownership ----------
  await db.insert(entityOwnerships).values([
    { entityId: bltPartners.id, ownerId: household.id, percent: 100, role: "Members" },
    { entityId: bltBuckeye.id, ownerId: household.id, percent: 100, role: "Members" },
    { entityId: bltFlats.id, ownerId: household.id, percent: 100, role: "Members" },
    { entityId: bltWashington.id, ownerId: household.id, percent: 100, role: "Members" },
    { entityId: bltMohawk.id, ownerId: household.id, percent: 100, role: "Members" },
    { entityId: bltWildcat.id, ownerId: household.id, percent: 100, role: "Members" },
    { entityId: b2Partners.id, ownerId: mike.id, percent: 50, role: "Capital Partner" },
    { entityId: b2Partners.id, ownerId: household.id, percent: 50, role: "Operating Partners" },
  ]);

  // ---------- Property managers ----------
  const [crm] = await db.insert(propertyManagers).values({
    name: "CRM Properties",
    contactName: "Audra Cannon",
    phone: "(765) 459-8034",
    website: "https://www.crmproperties.net/",
  }).returning();

  const [th] = await db.insert(propertyManagers).values({
    name: "T&H Realty Services",
    phone: "(317) 255-7767",
    website: "https://www.threaltyinc.com/",
  }).returning();

  // ---------- Normalized chart of accounts (seeded from CRM + T&H category comparison) ----------
  const catDefs: { name: string; group: string }[] = [
    { name: "Rent Income", group: "Income" },
    { name: "Other Income", group: "Income" },
    { name: "Management Fee", group: "Operating Expense" },
    { name: "Leasing / Lease Renewal Fee", group: "Operating Expense" },
    { name: "Repairs & Maintenance", group: "Operating Expense" },
    { name: "Turnover / Make-Ready", group: "Operating Expense" },
    { name: "Landscaping / Lawn Care", group: "Operating Expense" },
    { name: "Pest Control", group: "Operating Expense" },
    { name: "Tree Maintenance", group: "Operating Expense" },
    { name: "Utilities", group: "Operating Expense" },
    { name: "Supplies", group: "Operating Expense" },
    { name: "Equipment Rental", group: "Operating Expense" },
    { name: "Tenant Incentive / Gift", group: "Operating Expense" },
    { name: "Insurance", group: "Operating Expense" },
    { name: "Property Tax", group: "Operating Expense" },
    { name: "Mortgage / Debt Service", group: "Operating Expense" },
    { name: "Legal / Professional Fees", group: "Operating Expense" },
    { name: "Software Subscriptions", group: "Operating Expense" },
    { name: "Bank Fees", group: "Operating Expense" },
    { name: "Improvements / Capex", group: "Capex" },
    { name: "Owner Contribution", group: "Adjustment" },
    { name: "Owner Draw / Distribution", group: "Adjustment" },
  ];
  const insertedCats = await db.insert(normalizedCategories).values(catDefs).returning();
  const catId = (name: string) => insertedCats.find((c) => c.name === name)!.id;

  // Mapping observed CRM and T&H raw categories -> normalized categories.
  // This is seeded from the sample statements Patrick shared; expect to
  // extend this table as more statements are imported and new raw category
  // strings show up.
  const mappings: { pmId: string; rawCategory: string; normalizedCategoryId: string }[] = [
    // CRM Properties
    { pmId: crm.id, rawCategory: "Rent", normalizedCategoryId: catId("Rent Income") },
    { pmId: crm.id, rawCategory: "Management Fees", normalizedCategoryId: catId("Management Fee") },
    { pmId: crm.id, rawCategory: "Renewal Lease Fee", normalizedCategoryId: catId("Leasing / Lease Renewal Fee") },
    { pmId: crm.id, rawCategory: "Cleaning and Maintenance", normalizedCategoryId: catId("Repairs & Maintenance") },
    { pmId: crm.id, rawCategory: "Repairs", normalizedCategoryId: catId("Repairs & Maintenance") },
    { pmId: crm.id, rawCategory: "HVAC Service Contract", normalizedCategoryId: catId("Repairs & Maintenance") },
    { pmId: crm.id, rawCategory: "Lawn Care", normalizedCategoryId: catId("Landscaping / Lawn Care") },
    { pmId: crm.id, rawCategory: "Pest Control", normalizedCategoryId: catId("Pest Control") },
    { pmId: crm.id, rawCategory: "Tree Maintenance", normalizedCategoryId: catId("Tree Maintenance") },
    { pmId: crm.id, rawCategory: "Utility Expenses", normalizedCategoryId: catId("Utilities") },
    { pmId: crm.id, rawCategory: "Tenant Incentive", normalizedCategoryId: catId("Tenant Incentive / Gift") },
    { pmId: crm.id, rawCategory: "Eviction Fee", normalizedCategoryId: catId("Legal / Professional Fees") },
    { pmId: crm.id, rawCategory: "Owner Contribution", normalizedCategoryId: catId("Owner Contribution") },
    { pmId: crm.id, rawCategory: "Owner Draw", normalizedCategoryId: catId("Owner Draw / Distribution") },
    // T&H Realty Services
    { pmId: th.id, rawCategory: "Rent", normalizedCategoryId: catId("Rent Income") },
    { pmId: th.id, rawCategory: "Rent - First Month", normalizedCategoryId: catId("Rent Income") },
    { pmId: th.id, rawCategory: "Management Fee Expense", normalizedCategoryId: catId("Management Fee") },
    { pmId: th.id, rawCategory: "Leasing Fee", normalizedCategoryId: catId("Leasing / Lease Renewal Fee") },
    { pmId: th.id, rawCategory: "Lease Renewal Fee", normalizedCategoryId: catId("Leasing / Lease Renewal Fee") },
    { pmId: th.id, rawCategory: "Repairs Maintenance", normalizedCategoryId: catId("Repairs & Maintenance") },
    { pmId: th.id, rawCategory: "Repairs Turnover", normalizedCategoryId: catId("Turnover / Make-Ready") },
    { pmId: th.id, rawCategory: "Landscaping", normalizedCategoryId: catId("Landscaping / Lawn Care") },
    { pmId: th.id, rawCategory: "Utility Expenses", normalizedCategoryId: catId("Utilities") },
    { pmId: th.id, rawCategory: "Stock Supplies", normalizedCategoryId: catId("Supplies") },
    { pmId: th.id, rawCategory: "Supplies Maintenance", normalizedCategoryId: catId("Supplies") },
    { pmId: th.id, rawCategory: "Equipment Rental", normalizedCategoryId: catId("Equipment Rental") },
    { pmId: th.id, rawCategory: "Owner Contribution", normalizedCategoryId: catId("Owner Contribution") },
    { pmId: th.id, rawCategory: "Owner Draw", normalizedCategoryId: catId("Owner Draw / Distribution") },
  ];
  await db.insert(categoryMappings).values(mappings);

  // ---------- Properties ----------
  // Helper to reduce repetition
  const addProperty = async (p: typeof properties.$inferInsert) =>
    (await db.insert(properties).values(p).returning())[0];

  // Note: 17120 Moon Lake Ct (the primary residence) is intentionally NOT
  // seeded here — Patrick asked for it to be excluded from the app entirely,
  // not just filtered from rollups.

  const wayneSt = await addProperty({
    address: "1137 Wayne St", city: "Noblesville", state: "IN", zip: "46060",
    propertyType: "SFH 2/2", status: "leased",
    purchasePrice: 198745, purchaseDate: "2021-06-28",
    rehabBudget: 60000, rehabCompleteDate: "2021-10-01",
    putIntoServiceDate: "2021-10-01",
    currentEstValue: 264000, currentValueSource: "zillow",
    notes: "Held personally. Rented under market to Gina's mother. No property manager — self-managed family arrangement.",
  });

  const division1139 = await addProperty({
    address: "1139 Division St", city: "Noblesville", state: "IN", zip: "46060",
    propertyType: "Duplex 2/1 each side", status: "leased",
    purchasePrice: 255000, purchaseDate: "2023-04-28",
    rehabBudget: 80000, rehabCompleteDate: "2024-04-01",
    putIntoServiceDate: "2024-05-01",
    currentEstValue: 345000, currentValueSource: "Aug24 appraisal",
    notes: "Cash-out refi Oct 2024 for $150k.",
  });

  const buckeyeBldg = await addProperty({
    address: "110-112 S. Buckeye St", city: "Kokomo", state: "IN", zip: "46901",
    propertyType: "Mixed-use: 2/2 apt + 3 office suites", status: "rehab",
    purchasePrice: 206000, purchaseDate: "2024-07-01",
    rehabBudget: 130000, rehabSpentToDate: 100000,
    currentEstValue: 300000, currentValueSource: "PB estimate",
    notes: "Moved from BLT Buckeye LLC to BLT Flats LLC via quitclaim 4/17/2026 (through Patrick & Gina personally). No property manager yet — still under rehab.",
  });

  const wash1611 = await addProperty({
    address: "1611 S. Washington", city: "Kokomo", state: "IN", zip: "46902",
    propertyType: "SFH 2/2", status: "leased",
    purchasePrice: 90000, purchaseDate: "2024-12-18",
    rehabBudget: 35000, rehabCompleteDate: "2025-07-01",
    putIntoServiceDate: "2025-08-01",
    currentEstValue: 152000, currentValueSource: "Aug25 appraisal",
    notes: "Cash-out refi Aug 2025 for $105k.",
  });

  const wash738 = await addProperty({
    address: "738 S. Washington", city: "Kokomo", state: "IN", zip: "46901",
    propertyType: "Duplex 2/1 & 1/1", status: "leased",
    purchasePrice: 100000, purchaseDate: "2025-06-16",
    rehabBudget: 5000, putIntoServiceDate: "2025-06-01",
    currentEstValue: 111000, currentValueSource: "zillow",
  });

  const mohawk5109 = await addProperty({
    address: "5109 Mohawk", city: "Kokomo", state: "IN", zip: "46902",
    propertyType: "SFH 3/2", status: "leased",
    purchasePrice: 95000, purchaseDate: "2024-12-13",
    rehabBudget: 35000, rehabCompleteDate: "2025-07-01",
    putIntoServiceDate: "2025-07-01",
    currentEstValue: 148000, currentValueSource: "Aug25 appraisal",
    notes: "Cash-out refi Aug 2025 for $105k.",
  });

  const maumee808 = await addProperty({
    address: "808 Maumee", city: "Kokomo", state: "IN", zip: "46902",
    propertyType: "SFH 4/2", status: "leased",
    purchasePrice: 75000, purchaseDate: "2025-06-13",
    rehabBudget: 45000, rehabSpentToDate: 35000,
    putIntoServiceDate: "2026-03-24", // lease start date on file (808_Maumee_Kokomo_lease_20260324.pdf) — rehab was complete by then, exact rehabCompleteDate not on file
    currentEstValue: 141000, currentValueSource: "appraisal", currentValueAsOf: "2026-06-26", // refi appraisal, per Patrick 2026-09-04
    notes: "Moved from BLT Mohawk LLC to BLT Wildcat LLC via quitclaim 4/17/2026 (through Patrick & Gina personally). Rehab complete, leased since 3/24/2026 — status corrected from 'rehab' 2026-09-04 per Patrick. Value corrected 2026-09-04 to $141,000 per the refi appraisal (was $120,000 zillow estimate).",
  });

  const buckeye2000 = await addProperty({
    address: "2000 S Buckeye", city: "Kokomo", state: "IN", zip: "46902",
    propertyType: "SFH 4/1", status: "leased",
    purchasePrice: 95000, purchaseDate: "2025-08-27",
    currentEstValue: 112000, currentValueSource: "Aug25 appraisal",
  });

  const hemlock = await addProperty({
    address: "4076 S 450 E", city: "Hemlock", state: "IN", zip: "46937",
    propertyType: "SFH 3/1", status: "leased",
    purchasePrice: 60000, purchaseDate: "2025-08-27",
    currentEstValue: 85000, currentValueSource: "Aug25 appraisal",
  });

  const kingston = await addProperty({
    address: "225 S Kingston", city: "Kokomo", state: "IN", zip: "46901",
    propertyType: "Triplex 2/1, 1/1, 1/1", status: "leased",
    purchasePrice: 115000, purchaseDate: "2025-10-03",
    currentEstValue: 120000, currentValueSource: "Sep25 appraisal",
  });

  const division1339 = await addProperty({
    address: "1339 Division St", city: "Noblesville", state: "IN", zip: "46060",
    propertyType: "SFH 2/2", status: "leased",
    purchasePrice: 140000, purchaseDate: "2025-10-01",
    rehabCompleteDate: "2026-07-01", putIntoServiceDate: "2026-07-22",
    currentEstValue: 202000, currentValueSource: "zillow",
    notes: "Was mid-rehab as of Dec 2025 portfolio snapshot; rehab completed and leased starting 7/22/2026 per lease on file.",
  });

  // 615 Cherry: under contract, not yet closed — a pending acquisition, not
  // a real estate holding yet. Kept out of portfolio rollups (see page.tsx)
  // and excluded from the main properties table.
  const cherry615 = await addProperty({
    address: "615 Cherry", city: "Noblesville", state: "IN",
    propertyType: "2/1", status: "under_contract",
    purchasePrice: 169000,
    targetCloseDate: "2026-09-17",
    notes: "Under contract; target close 9/17/2026. Will be owned by BLT Wildcat LLC once closed. Underwriting model on file (VARE_615_Cherry_Noblesville).",
  });

  // ---------- Property <-> Entity ownership (current + historical, dated) ----------
  // BLT Buckeye -> BLT Flats and BLT Mohawk -> BLT Wildcat both routed
  // through Patrick & Gina personally on 4/17/2026 (same day, per the two
  // recorded quitclaim deeds), so that intermediate step is modeled explicitly
  // rather than collapsed into a direct LLC-to-LLC move.
  await db.insert(propertyOwnerships).values([
    { propertyId: wayneSt.id, entityId: personal.id, startDate: "2021-06-28" },
    { propertyId: division1139.id, entityId: bltPartners.id, startDate: "2023-04-28" },

    { propertyId: buckeyeBldg.id, entityId: bltBuckeye.id, startDate: "2024-07-01", endDate: "2026-04-17" },
    { propertyId: buckeyeBldg.id, entityId: personal.id, startDate: "2026-04-17", endDate: "2026-04-17", notes: "Momentary pass-through per quitclaim deeds recorded 4/29/2026 (both executed 4/17/2026)." },
    { propertyId: buckeyeBldg.id, entityId: bltFlats.id, startDate: "2026-04-17" },

    { propertyId: wash1611.id, entityId: bltWashington.id, startDate: "2024-12-18" },
    { propertyId: wash738.id, entityId: bltWashington.id, startDate: "2025-06-16" },

    { propertyId: mohawk5109.id, entityId: bltMohawk.id, startDate: "2024-12-13" },

    { propertyId: maumee808.id, entityId: bltMohawk.id, startDate: "2025-06-13", endDate: "2026-04-17" },
    { propertyId: maumee808.id, entityId: personal.id, startDate: "2026-04-17", endDate: "2026-04-17", notes: "Momentary pass-through per quitclaim deeds recorded 4/29/2026 (both executed 4/17/2026)." },
    { propertyId: maumee808.id, entityId: bltWildcat.id, startDate: "2026-04-17" },

    { propertyId: buckeye2000.id, entityId: b2Partners.id, startDate: "2025-08-27" },
    { propertyId: hemlock.id, entityId: b2Partners.id, startDate: "2025-08-27" },
    { propertyId: kingston.id, entityId: b2Partners.id, startDate: "2025-10-03" },
    { propertyId: division1339.id, entityId: b2Partners.id, startDate: "2025-10-01" },

    { propertyId: cherry615.id, entityId: bltWildcat.id, startDate: "2026-09-17", notes: "Not yet closed — target date, not an actual ownership start." },
  ]);

  // ---------- Property manager assignments ----------
  await db.insert(propertyPmAssignments).values([
    { propertyId: division1139.id, pmId: th.id, startDate: "2023-04-28" },
    { propertyId: wash1611.id, pmId: crm.id, startDate: "2024-12-18" },
    { propertyId: wash738.id, pmId: crm.id, startDate: "2025-06-16" },
    { propertyId: mohawk5109.id, pmId: crm.id, startDate: "2024-12-13" },
    { propertyId: maumee808.id, pmId: crm.id, startDate: "2025-06-13" },
    { propertyId: buckeye2000.id, pmId: crm.id, startDate: "2025-08-27" },
    { propertyId: hemlock.id, pmId: crm.id, startDate: "2025-08-27" },
    { propertyId: kingston.id, pmId: crm.id, startDate: "2025-10-03" },
    { propertyId: division1339.id, pmId: crm.id, startDate: "2025-10-01" },
    // wayneSt: no PM (family arrangement); buckeyeBldg: no PM yet (still rehab); cherry615: not closed yet.
  ]);

  // ---------- Units + Leases (from actual lease documents on file) ----------
  const [unitMohawk] = await db.insert(units).values({
    propertyId: mohawk5109.id, label: "Main House", bedrooms: 3, bathrooms: 2,
  }).returning();
  const [unitWash1611] = await db.insert(units).values({
    propertyId: wash1611.id, label: "Main House", bedrooms: 2, bathrooms: 2,
  }).returning();
  const [unitDivision1339] = await db.insert(units).values({
    propertyId: division1339.id, label: "Main House", bedrooms: 2, bathrooms: 2,
  }).returning();
  const [unitMaumee808] = await db.insert(units).values({
    propertyId: maumee808.id, label: "Main House", bedrooms: 4, bathrooms: 2,
  }).returning();
  const [unitWayneSt] = await db.insert(units).values({
    propertyId: wayneSt.id, label: "Main House", bedrooms: 2, bathrooms: 2,
  }).returning();
  const [unitDivision1139A, unitDivision1139B] = await db.insert(units).values([
    { propertyId: division1139.id, label: "Side A (renewed lease)", bedrooms: 2, bathrooms: 1 },
    { propertyId: division1139.id, label: "Side B (month-to-month)", bedrooms: 2, bathrooms: 1 },
  ]).returning();

  await db.insert(leases).values([
    {
      unitId: unitMohawk.id,
      tenantName: "Brian Christopher Bystrom & Amy Jolene Bystrom",
      rentAmount: 1400, startDate: "2025-07-25", endDate: "2026-07-31",
      status: "active",
      notes: "CRM Properties lease. $2,800 security deposit. Appliances provided: refrigerator, stove, dishwasher, washer, dryer. Converts to month-to-month at $75/mo fee if not renewed by 8/1/2026.",
    },
    {
      unitId: unitWash1611.id,
      tenantName: "Timothy Allen Robertson & Bethany Joyce Robertson",
      rentAmount: 1300, startDate: "2025-08-08", endDate: "2026-08-31",
      status: "active",
      notes: "CRM Properties lease. $2,400 security deposit. Appliances provided: refrigerator, stove. Converts to month-to-month at $75/mo fee if not renewed by 9/1/2026.",
    },
    {
      unitId: unitDivision1339.id,
      tenantName: "Carson Lynn Janes, Aidan Janes & Caleb Mills",
      rentAmount: 1800, startDate: "2026-07-22", endDate: "2027-07-31",
      status: "active",
      notes: "CRM Properties lease, landlord of record B2 Partners LLC. $1,800 security deposit. Appliances provided: stove, refrigerator, dishwasher, microwave, washer, dryer. Converts to month-to-month at $75/mo fee if not renewed by 8/1/2027.",
    },
    {
      unitId: unitMaumee808.id,
      tenantName: "Lucas Kyle Rozumalski & Carly Fields",
      rentAmount: 1500, startDate: "2026-03-24", endDate: "2027-03-31",
      status: "active",
      notes: "CRM Properties lease (808_Maumee_Kokomo_lease_20260324.pdf), landlord of record listed as BLT Mohawk, LLC on the lease itself even though the property is now titled to BLT Wildcat LLC per the 4/17/2026 quitclaim — likely just an unupdated template, not an actual ownership discrepancy. $1,500 security deposit. Appliances provided: stove, refrigerator, microwave, dishwasher, stacked washer/dryer. Converts to month-to-month at $75/mo fee if not renewed by 4/1/2027. Matches the VARE underwriting's projected rent exactly.",
    },
    {
      // Patrick's stated figure (updated 2026-09-04, was $600 as of
      // 2026-08-31), not a document — 1137 Wayne St is a family/personal
      // arrangement with no formal lease on file.
      unitId: unitWayneSt.id,
      tenantName: undefined,
      rentAmount: 700, startDate: undefined, endDate: undefined,
      status: "active",
      notes: "Rent figure is Patrick's own stated number, not from a lease document — this is a family/personal arrangement (Personal entity, no PM), so no formal lease exists to pull it from. Updated to $700 2026-09-04 per Patrick (was $600).",
    },
    {
      // Not from a lease document either — pulled from the T&H Realty PM
      // statement's July 2026 line items, which is the best current-rent
      // source available for this duplex (no lease docs on file for either
      // side). The two rows distinguish by lease status text in the PM
      // report, not by a formal unit label, so "Side A/B" here is just a
      // bookkeeping label, not necessarily which physical half they are.
      unitId: unitDivision1139A.id,
      tenantName: undefined,
      rentAmount: 1410, startDate: undefined, endDate: "2027-07-31",
      status: "active",
      notes: "From BLT Partners LLC's T&H Realty PM statement, July 2026: \"Rent + Pet Rent (Renewal 26-27) (07-2026)\" = $1,410 (10% PM fee -$141 matches the 10% rate seen elsewhere). Renewed lease, presumably running through 7/31/2027 per the \"26-27\" label — exact start date not stated in the PM report. No tenant name available from this source.",
    },
    {
      unitId: unitDivision1139B.id,
      tenantName: undefined,
      rentAmount: 1496, startDate: undefined, endDate: undefined,
      status: "active",
      notes: "From BLT Partners LLC's T&H Realty PM statement, July 2026: \"Rent (Month-to-Month) (07-2026)\" = $1,496 (10% PM fee -$149.60). Combined with Side A's $1,410, this is the $2,906 total income shown on that statement. No tenant name or lease document available from this source — month-to-month, no end date.",
    },
  ]);
  // Other units/leases (738 S. Washington, Buckeye/Flats, 2000 S Buckeye,
  // Hemlock, Kingston) not yet entered — no lease document or PM report
  // rent figure on file yet for those. Add as they come in.

  // ---------- Loans (from portfolio workbook "mortgage balance") ----------
  await db.insert(loans).values([
    // Terms below are the ones we actually have on file so far — pulled from
    // the per-property tabs in BLT_Portfolio.xlsx (2026-08-31 pass). Only
    // filled in where the source was a real document, not guessed; where a
    // number is inferred rather than stated outright, that's called out in
    // notes so it can be corrected once Patrick confirms it.
    {
      propertyId: wayneSt.id, lender: "Union Savings", loanType: "conventional",
      currentBalance: 93100, prepayPenaltyTerms: undefined,
      rate: 0.025, termMonths: 180, originationDate: "2021-06-28",
      // originalAmount is inferred, not stated: portfolio notes say "acquired
      // with 20% down" against the $198,745 purchase price, so
      // 198745 * 0.80 = 158,996. The tab's own "terms" field (15yr fixed
      // 2.5%) is a real stated number; the balance field in that tab was
      // corrupted ("0434 as of 2024/11/03") so current_balance here is still
      // the portfolio workbook's rollup figure, not from this tab.
      originalAmount: 158996,
      notes: "Rate/term from BLT_Portfolio.xlsx '1137 Wayne St' tab (15yr fixed 2.5%). Original loan amount is an estimate (80% of $198,745 purchase price, per the portfolio notes' \"20% down\") — please confirm the real number. Insurance carrier on file (State Farm) but no premium amount yet.",
    },
    {
      propertyId: division1139.id, currentBalance: 148400, prepayPenaltyTerms: "3-2-1 year/% penalty",
      lender: "Commercial Lender LLC",
      rate: 0.071759, termMonths: 360, originationDate: "2024-10-01",
      // originalAmount ties to the Oct 2024 cash-out refi ("$150k" per the
      // portfolio notes) and matches this tab's stated Aug-2024 balance
      // ($150,000) almost exactly — current_balance above ($148,400) being
      // slightly lower is consistent with ~2 years of paydown since.
      originalAmount: 150000,
      // The tab states a combined "monthly PTI" of $1,577 rather than
      // separate tax/insurance figures. Amortizing $150,000 @ 7.1759%/30yr
      // gives P&I ≈ $1,015.74, so the $561.26 remainder is the real combined
      // tax+insurance — stored in monthlyTaxEscrow since the fields don't
      // split further; monthlyInsuranceEscrow stays null so the dashboard
      // still (correctly) flags this as a partial breakdown even though the
      // PITI total itself is accurate.
      monthlyTaxEscrow: 561.26,
      notes: "Rate/term/balance from BLT_Portfolio.xlsx '1139 Division St' tab, which also states a combined monthly PTI of $1,577 — the $561.26 in monthly_tax_escrow is that stated total minus computed P&I, i.e. real combined tax+insurance, not a true tax-only figure (the tab doesn't break it out further).",
    },
    {
      propertyId: wash1611.id, currentBalance: 104800, prepayPenaltyTerms: "3-2-1 year/% penalty",
      // VARE_1611_S_Washington_Kokomo_20250826.xlsx "Inputs" sheet: this is
      // the underwriting for the Aug-2025 DSCR refi itself (Loan Amount
      // $106,400 vs. the $104,800 current balance above — consistent with
      // ~a year of paydown), not the earlier hard-money terms rejected
      // last pass. Property Tax $2,660/yr -> $221.67/mo; Insurance/mo
      // $74.42 stated directly.
      rate: 0.0675, termMonths: 360, originalAmount: 106400,
      monthlyTaxEscrow: 2660 / 12, monthlyInsuranceEscrow: 74.42,
      notes: "Rate/term/loan amount/tax/insurance from VARE_1611_S_Washington_Kokomo_20250826.xlsx (the underwriting for the Aug-2025 DSCR refi) — these are underwriting-file figures, not yet confirmed against the actual closing docs/mortgage statement Patrick will send.",
    },
    { propertyId: wash738.id, currentBalance: 74700, prepayPenaltyTerms: "3-2-1 year/% penalty",
      // VARE_738_S_Washington_Kokomo_20250728.xlsx: Loan Amount $75,000 vs.
      // current balance $74,700 — consistent with a loan closed shortly
      // after this file's date. Property Tax $1,140/yr -> $95/mo;
      // Insurance/mo $175 stated directly.
      rate: 0.07, termMonths: 360, originalAmount: 75000,
      monthlyTaxEscrow: 1140 / 12, monthlyInsuranceEscrow: 175,
      notes: "Rate/term/loan amount/tax/insurance from VARE_738_S_Washington_Kokomo_20250728.xlsx — underwriting-file figures, not yet confirmed against actual closing docs/mortgage statement.",
    },
    {
      // Real cash-out refi closing package (Elite Commercial Servicing payoff
      // $74,807.59 -> United Wholesale Mortgage, LLC new loan), closed
      // 8/28/2025 — supersedes the VARE DRAFT file's guessed terms entirely.
      // Loan Amount $105,000 @ 6.75%/30yr, P&I $681.03/mo. Property Taxes
      // $155.67/mo + Homeowner's Insurance $75.17/mo stated directly on the
      // Closing Disclosure/settlement statement (= the $230.84/mo estimated
      // escrow line). Prepayment penalty: as high as $3,150 if paid off in
      // the first 3 years. current_balance is the amortization schedule's
      // balance after the payment nearest today (2026-08-31), not the
      // original $105,000.
      propertyId: mohawk5109.id, currentBalance: 103977.10, prepayPenaltyTerms: "As high as $3,150 if paid off in first 3 years",
      lender: "United Wholesale Mortgage, LLC",
      rate: 0.0675, termMonths: 360, originalAmount: 105000, originationDate: "2025-08-28",
      monthlyTaxEscrow: 155.67, monthlyInsuranceEscrow: 75.17,
      notes: "Rate/term/loan amount/tax/insurance/prepay terms from the actual closing package (5109_Mohawk_Kokomo_closing_package_20250828.pdf — Closing Disclosure + amortization schedule + ALTA settlement statement), not the earlier VARE DRAFT file. Confirmed, not an estimate.",
    },
    {
      // Real ALTA settlement statement (individual VARE_2000_S_Buckeye file,
      // not the withdrawn combined 3-property one). Loan Amount $71,250
      // (UWM) matches VARE's Inputs sheet and is close to the current
      // balance below (minor paydown since 8/27/2025 close). County Taxes
      // $2,338/yr -> $194.83/mo and Homeowner's Insurance $115.00/mo (both
      // straight off the settlement statement's impound lines, not VARE
      // estimates). Rate/term from VARE Inputs (7%/30yr).
      propertyId: buckeye2000.id, currentBalance: 71100, prepayPenaltyTerms: "3-2-1 year/% penalty",
      lender: "United Wholesale Mortgage, LLC",
      rate: 0.07, termMonths: 360, originalAmount: 71250, originationDate: "2025-08-27",
      monthlyTaxEscrow: 194.83, monthlyInsuranceEscrow: 115.00,
      notes: "Rate/term from VARE_2000_S_Buckeye_Kokomo_20250731.xlsx; loan amount/tax/insurance confirmed against 2000_S_Buckeye_Kokomo_ALTA_settlement_20250827.pdf.",
    },
    {
      // Real ALTA settlement statement. Loan Amount $45,000 (UWM) matches
      // VARE. County Taxes $1,370/yr -> $114.17/mo and Homeowner's
      // Insurance $87.58/mo straight off the settlement statement.
      propertyId: hemlock.id, currentBalance: 44900, prepayPenaltyTerms: "3-2-1 year/% penalty",
      lender: "United Wholesale Mortgage, LLC",
      rate: 0.06875, termMonths: 360, originalAmount: 45000, originationDate: "2025-08-27",
      monthlyTaxEscrow: 114.17, monthlyInsuranceEscrow: 87.58,
      notes: "Rate/term from VARE_4076_S_450E_Hemlock_20250731.xlsx; loan amount/tax/insurance confirmed against 4076_S_450_E_Hemlock_ALTA_settlement_20250827.pdf.",
    },
    {
      // Real ALTA settlement statement. Loan Amount $86,250 (Commercial
      // Lender LLC) matches VARE. County Taxes $2,784/yr -> $232.00/mo and
      // Homeowner's Insurance Premium $1,631/yr -> $135.92/mo, both straight
      // off the settlement statement's impound lines.
      propertyId: kingston.id, currentBalance: 86000, prepayPenaltyTerms: "3-2-1 year/% penalty",
      lender: "Commercial Lender LLC",
      rate: 0.07466, termMonths: 360, originalAmount: 86250, originationDate: "2025-10-03",
      monthlyTaxEscrow: 232.00, monthlyInsuranceEscrow: 135.92,
      notes: "Rate/term from VARE_225_S_Kingston_Kokomo_20250924.xlsx; loan amount/tax/insurance confirmed against 225_S_Kingston_Kokomo_ALTA_settlement_20251003.pdf.",
    },
    // 110-112 S. Buckeye St (BLT Flats) — cash purchase, no mortgage
    // ("Mortgage1: n/a" on its portfolio tab), so no principal/rate/term.
    // It does have a stated annual insurance premium ($2,233, Berkshire
    // Hathaway) though, which is real PITI-relevant data on its own.
    { propertyId: buckeyeBldg.id,
      monthlyInsuranceEscrow: 2233 / 12,
      notes: "Cash purchase (BLT_Portfolio.xlsx '110 112 S. Buckeye St' tab: 'Mortgage1: n/a') — no loan, so no P&I ever applies here. Annual insurance premium ($2,233/yr, Berkshire Hathaway, from the same tab) converted to a monthly escrow figure. No property tax figure on file yet." },
    {
      // Real cash-out refi closing package (Bello/Cake Mortgage Corp. via
      // Meridian Title), closed 6/26/2026 — this loan actually exists now,
      // no longer a VARE-projected plan. Loan Amount $105,750 @ 6.75%/30yr,
      // P&I $685.89/mo. Escrow: Property Taxes $159.83/mo + Homeowner's
      // Insurance $84.33/mo (both stated directly on the Closing Disclosure,
      // matching the VARE projection almost exactly). Prepayment penalty:
      // as high as $2,855 if paid off in the first 5 years. Closed just
      // before this pass, so current_balance is still ~the original amount.
      propertyId: maumee808.id, currentBalance: 105750, prepayPenaltyTerms: "As high as $2,855 if paid off in first 5 years",
      lender: "Cake Mortgage Corp.",
      rate: 0.0675, termMonths: 360, originalAmount: 105750, originationDate: "2026-06-26",
      monthlyTaxEscrow: 159.83, monthlyInsuranceEscrow: 84.33,
      notes: "Rate/term/loan amount/tax/insurance/prepay terms from the actual closing package (808_Maumee_Kokomo_Bello_Cake_Mortgage_Meridian_closing_package_20260626.pdf). Confirmed, not an estimate — the cash-out refi VARE_808_Maumee_Kokomo_20260627.xlsx projected has now actually closed.",
    },
    {
      // Still cash-financed as of this pass — the cash-out refi Patrick
      // described is in process (expected to close within ~30 days of
      // 2026-08-31) but hasn't closed yet, so no loan row terms here yet.
      // Property tax updated to the real figure off the original purchase's
      // ALTA settlement statement ($1,274.86/yr per the county tax
      // proration line — likely to change once the county reassesses post-
      // sale, but still more grounded than VARE's $2,500/yr guess).
      // Insurance stays the VARE Inputs figure — no better source yet.
      propertyId: division1339.id,
      monthlyTaxEscrow: 1274.86 / 12, monthlyInsuranceEscrow: 85.42,
      notes: "Cash purchase (1339_Division_Noblesville_ALTA_settlement_20251001.pdf — no loan listed). Property tax ($1,274.86/yr) is the pre-sale county tax proration from that settlement statement; may rise after reassessment. Insurance ($85.42/mo) still from VARE_1339_Division_Noblesville_20260730.xlsx, no better source yet. A cash-out refi is in progress, expected to close within ~30 days of 2026-08-31 — once it does, this needs real loan terms and the resulting proceeds split with Mike per the B2 Partners stack method." },
  ]);

  // ---------- Underwriting model (from VARE files) ----------
  await db.insert(underwritingModels).values([
    {
      propertyId: cherry615.id,
      sourceFile: "VARE_615_Cherry_Noblesville_20260815.xlsx",
      purchasePrice: 169000,
      rehabCostBudget: 51010,
      arv: 260000,
      projectedMonthlyRent: 1800,
      vacancyPct: 0.04,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.09,
      projectedYear1CashFlow: -1345.23,
      projectedYear1TotalReturn: 21477.28,
      notes: "Year 1 total return figure is equity growth + cash flow per the underwriting model, not cash flow alone.",
    },
    {
      propertyId: maumee808.id,
      sourceFile: "VARE_808_Maumee_Kokomo_20260627.xlsx",
      purchasePrice: 75000,
      rehabCostBudget: 53228.32,
      arv: 141000,
      projectedMonthlyRent: 1500,
      vacancyPct: 0.02,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.09,
      projectedYear1CashFlow: 120.05,
      projectedYear1TotalReturn: 5768.97,
      // The DSCR refi this file projected (Loan Amount $105,750 @
      // 6.75%/30yr) has since actually closed (6/26/2026) — see the loans
      // table entry, now populated with the real closing package terms
      // rather than a plan.
      notes: "Projected a future DSCR refi at $105,750 / 6.75% / 30yr — that refi has now closed; see the loans table for the confirmed terms. Real lease also now on file: $1,500/mo, tenants Lucas Rozumalski & Carly Fields, 3/24/2026-3/31/2027, matches this projection exactly.",
    },
    {
      propertyId: wash1611.id,
      sourceFile: "VARE_1611_S_Washington_Kokomo_20250826.xlsx",
      purchasePrice: 90000,
      rehabCostBudget: 29973,
      arv: 152000,
      projectedMonthlyRent: 1300,
      vacancyPct: 0.04,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.09,
      projectedYear1CashFlow: -1972.71,
      projectedYear1TotalReturn: 17175.07,
      notes: "This is the underwriting for the actual Aug-2025 DSCR refi (see the loans table entry for the resulting rate/term/loan amount/escrow), not a pre-purchase pro forma.",
    },
    {
      propertyId: wash738.id,
      sourceFile: "VARE_738_S_Washington_Kokomo_20250728.xlsx",
      purchasePrice: 100000,
      // Corrected 2026-08-31: last pass I read $43,489 of itemized work off
      // this file's "Renovation" tab and preferred it over the Inputs tab's
      // $0 Rehab Cost, assuming the Inputs cell was stale. Patrick clarified
      // that was backwards — the Renovation tab's link was pointing at a
      // different property's data left over from when this VARE file was
      // first created, and $0 rehab (turnkey acquisition) was correct all
      // along. He's sent a corrected master copy with that link fixed (now
      // genuinely empty/all-"No" on the Renovation tab), and re-running the
      // capex extraction against it correctly produces zero line items for
      // this property.
      rehabCostBudget: 0,
      arv: 100000,
      projectedMonthlyRent: 1150,
      vacancyPct: 0.02,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.09,
      projectedYear1CashFlow: 1288.59,
      projectedYear1TotalReturn: 1648.82,
      notes: "Turnkey acquisition (no rehab budgeted) — see the loans table entry for the resulting loan's rate/term/amount/escrow.",
    },
    {
      propertyId: mohawk5109.id,
      sourceFile: "VARE_5109_Mohawk_Kokomo_DRAFT_20250821.xlsx",
      purchasePrice: 95000,
      rehabCostBudget: 38619,
      arv: 148000,
      projectedMonthlyRent: 1400,
      vacancyPct: 0.04,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.09,
      projectedYear1CashFlow: -750.90,
      projectedYear1TotalReturn: 572.71,
      notes: "Filename says DRAFT, and this refi's projected terms ($103,600 loan) turned out a bit off from the actual closing (real loan was $105,000) — see the loans table entry, now populated with the confirmed closing package terms instead of this draft's guess.",
    },
    {
      propertyId: division1339.id,
      sourceFile: "VARE_1339_Division_Noblesville_20260730.xlsx",
      purchasePrice: 140000,
      rehabCostBudget: 66438.1,
      arv: 260000,
      projectedMonthlyRent: 1800,
      vacancyPct: 0.04,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.09,
      projectedYear1CashFlow: -1345.23,
      projectedYear1TotalReturn: 50522.18,
      // Still cash-financed as of this pass — a cash-out refi is in process
      // (expected to close within ~30 days of 2026-08-31; see loans table
      // note) but hasn't closed yet, so this file's projected refi terms
      // (Loan Amount $156,000 @ 7%/30yr) stay here as a plan, not in loans.
      // Real property tax now in loans.monthlyTaxEscrow from the original
      // purchase's ALTA settlement statement, more grounded than this
      // file's $2,500/yr guess.
      notes: "Projects a future refi at $156,000 / 7% / 30yr — not entered into the loans table since no loan has actually closed on this property yet (still the original cash acquisition); a cash-out refi is in progress and expected to close within ~30 days. Once it closes, proceeds need to be split with Mike per the B2 Partners stack method (Patrick flagged this needs refining — should be derivable from QBO).",
    },
    {
      propertyId: kingston.id,
      sourceFile: "VARE_225_S_Kingston_Kokomo_20250924.xlsx",
      purchasePrice: 115000,
      rehabCostBudget: 7300,
      arv: 165900,
      projectedMonthlyRent: 1855,
      vacancyPct: 0.04,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.08,
      projectedYear1CashFlow: 563.61,
      projectedYear1TotalReturn: 43132.25,
      notes: "This is the actual acquisition underwriting (not the withdrawn combined 3-property file) — see the loans table entry for the resulting rate/term/loan amount/escrow, confirmed against 225_S_Kingston_Kokomo_ALTA_settlement_20251003.pdf.",
    },
    {
      propertyId: buckeye2000.id,
      sourceFile: "VARE_2000_S_Buckeye_Kokomo_20250731.xlsx",
      purchasePrice: 95000,
      rehabCostBudget: 6800,
      arv: 133300,
      projectedMonthlyRent: 1235,
      vacancyPct: 0.04,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.08,
      projectedYear1CashFlow: 2526.03,
      projectedYear1TotalReturn: 32511.79,
      notes: "This is the actual acquisition underwriting (not the withdrawn combined 3-property file) — see the loans table entry for the resulting rate/term/loan amount/escrow, confirmed against 2000_S_Buckeye_Kokomo_ALTA_settlement_20250827.pdf.",
    },
    {
      propertyId: hemlock.id,
      sourceFile: "VARE_4076_S_450E_Hemlock_20250731.xlsx",
      purchasePrice: 60000,
      rehabCostBudget: 4000,
      arv: 85900,
      projectedMonthlyRent: 815,
      vacancyPct: 0.04,
      repairPct: 0.04,
      capexPct: 0.04,
      pmFeePct: 0.08,
      projectedYear1CashFlow: 1441.54,
      projectedYear1TotalReturn: 20198.81,
      notes: "This is the actual acquisition underwriting (not the withdrawn combined 3-property file) — see the loans table entry for the resulting rate/term/loan amount/escrow, confirmed against 4076_S_450_E_Hemlock_ALTA_settlement_20250827.pdf.",
    },
  ]);

  // ---------- Maintenance events (one-off, hand-entered — not from the VARE
  // Renovation-tab pipeline; see import-maintenance-events.ts for that) ----------
  await db.insert(maintenanceEvents).values([
    {
      // From BLT_Partners_LLC_Transaction_List_by_Date.csv (BLT Partners
      // LLC's shared checking account, which is NOT currently imported into
      // capital_contributions the way B2 Partners' is — this is the one
      // transaction pulled out of it by hand, per Patrick 2026-09-01.
      // Corrected same day: first attributed to 1611 S. Washington (going
      // on the similar-looking $4,000/$700 Cesario Lopez roofing checks in
      // the separate B2 Partners account), Patrick then clarified this
      // particular $3,600 one is actually 1139 Division St's new roof —
      // and that a third, ~$3,000 Cesario Lopez transaction for 1611 S.
      // Washington is real but hasn't shown up in any file provided yet.
      propertyId: division1139.id,
      category: "Roofing",
      description: "Roofing labor and materials — new roof",
      eventDate: "2026-04-01",
      cost: 3600,
      isCapex: true,
      notes: "Check 8003 to Cesario Lopez Ramirez, from BLT_Partners_LLC_Transaction_List_by_Date.csv (BLT Partners LLC checking, account 5200 Repairs & maintenance:5230 Roofing/Exterior repairs) — confirmed by Patrick as 1139 Division St, not to be confused with the similarly-named Cesario Lopez roofing checks in the B2 Partners LLC checking account (Checks 8005/8006, both 1339 Division) or the still-missing ~$3,000 1611 S. Washington one. The rest of that BLT Partners LLC file hasn't been mined for other property-specific capex yet — worth doing if there's more like this in there.",
    },
  ]);

  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
