// BLT Portfolio Manager — data model (Drizzle / SQLite)
//
// Modeling notes:
// - Patrick + Gina are modeled as ONE combined owner ("Bogan-Rhineberger
//   Household") wherever they co-own something, per Patrick's instruction.
//   The one place a real split shows up is B2 Partners LLC (Mike Bogan 50% /
//   Household 50%), and even there, until a given property's first
//   refinance, B2 Partners' operating agreement uses separate "Acquisition
//   Stack" (Mike) / "Rehab Stack" (Patrick+Gina, 50/50 between them) math —
//   see propertyOwnerStakes.stackPhase.
// - Entities can be dissolved and properties can move between entities over
//   time (BLT Buckeye -> BLT Flats, BLT Mohawk -> BLT Wildcat, summer 2026),
//   so property ownership is a dated history table, not a single FK on
//   Property. "Current owner" = the row with endDate null.
// - The two property managers (CRM Properties, T&H Realty Services) report
//   monthly statements using different expense category wording for
//   similar things. Raw line items are stored as the PM wrote them;
//   categoryMappings translates each PM's raw wording to one normalized
//   chart of accounts (normalizedCategories) for cross-entity reporting.

import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

// ---------- App login accounts (not to be confused with `owners` above,
// which models real-world ownership stakes) ----------

export const users = sqliteTable("users", {
  id: id(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"), // ISO datetime; null = not locked
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

// ---------- Owners ----------

export const owners = sqliteTable("owners", {
  id: id(),
  name: text("name").notNull().unique(), // "Bogan-Rhineberger Household", "Mike Bogan"
  isHousehold: integer("is_household", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
});

// ---------- Entities (LLCs + "Personal") ----------

export const entities = sqliteTable("entities", {
  id: id(),
  name: text("name").notNull().unique(), // "BLT Partners LLC", "Personal"
  entityType: text("entity_type").notNull(), // "LLC" | "Personal"
  taxStatus: text("tax_status"), // "S-corp"
  formedDate: text("formed_date"), // ISO date
  dissolvedDate: text("dissolved_date"),
  managingMember: text("managing_member"),
  quickbooksSetUp: integer("quickbooks_set_up", { mode: "boolean" }).notNull().default(false),
  quickbooksAccountName: text("quickbooks_account_name"), // matches QBO "Location" e.g. BLTMohawkLLC
  notes: text("notes"),
});

export const entityOwnerships = sqliteTable("entity_ownerships", {
  id: id(),
  entityId: text("entity_id").notNull().references(() => entities.id),
  ownerId: text("owner_id").notNull().references(() => owners.id),
  percent: real("percent").notNull(), // 0-100
  role: text("role"), // "Managing Member", "Capital Partner", "Operating Partner"
  startDate: text("start_date"),
  endDate: text("end_date"),
});

export const bankAccounts = sqliteTable("bank_accounts", {
  id: id(),
  entityId: text("entity_id").notNull().references(() => entities.id),
  label: text("label").notNull(), // "Checking", "Savings"
  institution: text("institution"),
  quickbooksAccountName: text("quickbooks_account_name"),
  notes: text("notes"),
});

// ---------- Properties ----------

export const properties = sqliteTable("properties", {
  id: id(),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  propertyType: text("property_type"), // "SFH 2/2", "Duplex", "Triplex", "Mixed-use"
  status: text("status").notNull(), // under_contract | rehab | leased | vacant | personal_residence | sold
  purchasePrice: real("purchase_price"),
  purchaseDate: text("purchase_date"),
  targetCloseDate: text("target_close_date"), // for under_contract properties not yet closed
  rehabBudget: real("rehab_budget"),
  rehabSpentToDate: real("rehab_spent_to_date"),
  rehabCompleteDate: text("rehab_complete_date"),
  putIntoServiceDate: text("put_into_service_date"),
  currentEstValue: real("current_est_value"),
  currentValueSource: text("current_value_source"), // "zillow", "appraisal", "PB estimate"
  currentValueAsOf: text("current_value_as_of"),
  notes: text("notes"),
});

// Which entity owns a property, over time. Current owner = row with endDate null.
export const propertyOwnerships = sqliteTable("property_ownerships", {
  id: id(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  entityId: text("entity_id").notNull().references(() => entities.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"), // null = current
  notes: text("notes"),
});

// For properties like B2 Partners' where the household's combined % and
// Mike's % need to be visible even though entity-level ownership is one row.
export const propertyOwnerStakes = sqliteTable("property_owner_stakes", {
  id: id(),
  propertyOwnershipId: text("property_ownership_id").notNull().references(() => propertyOwnerships.id),
  ownerId: text("owner_id").notNull().references(() => owners.id),
  percent: real("percent").notNull(),
  stackPhase: text("stack_phase"), // "pre_first_refi" | "post_first_refi" | null
});

export const units = sqliteTable("units", {
  id: id(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  label: text("label").notNull(), // "Unit 1", "Unit A", "Main House"
  bedrooms: integer("bedrooms"),
  bathrooms: real("bathrooms"),
  sqft: integer("sqft"),
});

export const loans = sqliteTable("loans", {
  id: id(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  lender: text("lender"),
  loanType: text("loan_type"), // "DSCR", "hard money", "conventional"
  originalAmount: real("original_amount"),
  originationDate: text("origination_date"),
  rate: real("rate"),
  termMonths: integer("term_months"),
  prepayPenaltyTerms: text("prepay_penalty_terms"),
  currentBalance: real("current_balance"),
  balanceAsOf: text("balance_as_of"),
  // Escrowed monthly tax/insurance, when known — not derivable from rate/
  // term/balance the way P&I is, so these stay null (rendered as "—") until
  // entered from an actual mortgage statement.
  monthlyTaxEscrow: real("monthly_tax_escrow"),
  monthlyInsuranceEscrow: real("monthly_insurance_escrow"),
  notes: text("notes"),
});

// ---------- Leases / Tenants ----------

export const leases = sqliteTable("leases", {
  id: id(),
  unitId: text("unit_id").notNull().references(() => units.id),
  tenantName: text("tenant_name"),
  rentAmount: real("rent_amount"),
  petRent: real("pet_rent"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status").notNull(), // active | renewed | month_to_month | ended | vacant
  notes: text("notes"),
});

// ---------- Maintenance / rehab / systems ----------

export const vendors = sqliteTable("vendors", {
  id: id(),
  name: text("name").notNull(),
  category: text("category"), // "HVAC", "Plumbing", "Roofing", "Lawn Care", "Pest Control", "Insurance", "General Contractor"
  phone: text("phone"),
  notes: text("notes"),
});

// Recurring/standing vendor relationship per property (HVAC service contract, insurance carrier, etc.)
export const propertyVendors = sqliteTable("property_vendors", {
  id: id(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  vendorId: text("vendor_id").notNull().references(() => vendors.id),
  role: text("role").notNull(), // "HVAC Service", "Plumbing Service", "Insurance", "Lawn Care", "Pest Control"
  terms: text("terms"),
  acctNumber: text("acct_number"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

// One-off or recurring maintenance/capex events — appliances, HVAC/roof replacement, rehab line items.
export const maintenanceEvents = sqliteTable("maintenance_events", {
  id: id(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  vendorId: text("vendor_id").references(() => vendors.id),
  category: text("category").notNull(), // "HVAC", "Roof", "Appliance - Water Heater", "Flooring", "Rehab - General"
  description: text("description"),
  eventDate: text("event_date"),
  cost: real("cost"),
  isCapex: integer("is_capex", { mode: "boolean" }).notNull().default(false),
  expectedLifeYears: integer("expected_life_years"),
  notes: text("notes"),
});

// ---------- Property managers + monthly report intake ----------

export const propertyManagers = sqliteTable("property_managers", {
  id: id(),
  name: text("name").notNull().unique(), // "CRM Properties", "T&H Realty Services"
  contactName: text("contact_name"),
  phone: text("phone"),
  website: text("website"),
});

export const propertyPmAssignments = sqliteTable("property_pm_assignments", {
  id: id(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  pmId: text("pm_id").notNull().references(() => propertyManagers.id),
  startDate: text("start_date"),
  endDate: text("end_date"), // null = current
  notes: text("notes"),
});

// One monthly (or annual) owner statement from a PM, at the entity level as reported.
export const pmReports = sqliteTable("pm_reports", {
  id: id(),
  pmId: text("pm_id").notNull().references(() => propertyManagers.id),
  entityId: text("entity_id").references(() => entities.id),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  statementDate: text("statement_date"),
  beginningBalance: real("beginning_balance"),
  endingBalance: real("ending_balance"),
  totalIncome: real("total_income"),
  totalExpenses: real("total_expenses"),
  totalDistribution: real("total_distribution"),
  sourceFile: text("source_file"), // filename imported from, for traceability
});

// Raw line items as the PM reported them (their own category wording, per-property sub-block if given).
export const pmReportLineItems = sqliteTable("pm_report_line_items", {
  id: id(),
  reportId: text("report_id").notNull().references(() => pmReports.id),
  propertyLabel: text("property_label"), // free-text property/unit label as it appeared on the statement
  propertyId: text("property_id").references(() => properties.id), // resolved match, null if the importer couldn't match propertyLabel to a known property
  rawCategory: text("raw_category").notNull(), // "Lawn Care", "Landscaping", "Repairs Maintenance" — PM's own wording
  description: text("description"),
  date: text("date"),
  amount: real("amount").notNull(), // positive = income/credit, negative = expense/draw, per statement convention
  normalizedCategoryId: text("normalized_category_id").references(() => normalizedCategories.id),
});

export const normalizedCategories = sqliteTable("normalized_categories", {
  id: id(),
  name: text("name").notNull().unique(), // "Rent Income", "Repairs & Maintenance", "Landscaping", "Utilities", "Management Fee", "Insurance", "Property Tax", "Owner Contribution", "Owner Draw"
  group: text("group").notNull(), // "Income" | "Operating Expense" | "Capex" | "Adjustment"
});

export const categoryMappings = sqliteTable("category_mappings", {
  id: id(),
  pmId: text("pm_id").notNull().references(() => propertyManagers.id),
  rawCategory: text("raw_category").notNull(), // exact PM wording, e.g. "HVAC Service Contract"
  normalizedCategoryId: text("normalized_category_id").notNull().references(() => normalizedCategories.id),
});

// ---------- Capital contributions / stack ledger (B2 Partners Acquisition Stack vs Rehab Stack) ----------
//
// Populated from QuickBooks transaction exports. Per the B2 Partners LLC
// operating agreement (Section 3.2), Acquisition Cash (purchase price +
// closing costs, funded by Mike as Capital Partner) and Rehab Cash
// (renovation/value-add spend, funded by Patrick+Gina as Operating Partners)
// are tracked per property until that property's first Refinance. This
// table is the actual ledger of that — one row per matched transaction —
// so per-property stack totals can be computed rather than guessed.
export const capitalContributions = sqliteTable("capital_contributions", {
  id: id(),
  entityId: text("entity_id").notNull().references(() => entities.id),
  propertyId: text("property_id").references(() => properties.id), // null if not matched to a specific property yet
  date: text("date").notNull(),
  stackType: text("stack_type"), // "acquisition" | "rehab" | null (unclassified)
  contributorOwnerId: text("contributor_owner_id").references(() => owners.id), // who funded it, if a contribution row
  amount: real("amount").notNull(), // negative = spend, positive = contribution, matches QBO sign convention
  memo: text("memo"),
  qboAccount: text("qbo_account"), // raw QBO "Split"/account string, empty string/null = uncategorized in QBO
  needsQboCleanup: integer("needs_qbo_cleanup", { mode: "boolean" }).notNull().default(false),
  sourceFile: text("source_file"),
});

// ---------- Underwriting (VARE-style pro forma) vs actuals ----------

export const underwritingModels = sqliteTable("underwriting_models", {
  id: id(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  sourceFile: text("source_file"), // e.g. "VARE_615_Cherry_Noblesville_20260815.xlsx"
  purchasePrice: real("purchase_price"),
  rehabCostBudget: real("rehab_cost_budget"),
  arv: real("arv"),
  projectedMonthlyRent: real("projected_monthly_rent"),
  vacancyPct: real("vacancy_pct"),
  repairPct: real("repair_pct"),
  capexPct: real("capex_pct"),
  pmFeePct: real("pm_fee_pct"),
  projectedYear1CashFlow: real("projected_year1_cash_flow"),
  projectedYear1TotalReturn: real("projected_year1_total_return"),
  notes: text("notes"),
});

// ---------- Relations (for query ergonomics) ----------

export const propertiesRelations = relations(properties, ({ many }) => ({
  units: many(units),
  ownershipHistory: many(propertyOwnerships),
  loans: many(loans),
  maintenanceEvents: many(maintenanceEvents),
  vendorAssignments: many(propertyVendors),
  underwriting: many(underwritingModels),
  pmAssignments: many(propertyPmAssignments),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  property: one(properties, { fields: [units.propertyId], references: [properties.id] }),
  leases: many(leases),
}));

export const entitiesRelations = relations(entities, ({ many }) => ({
  ownerships: many(entityOwnerships),
  propertyOwnerships: many(propertyOwnerships),
  bankAccounts: many(bankAccounts),
  pmReports: many(pmReports),
}));
