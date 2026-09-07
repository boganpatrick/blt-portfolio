# BLT Portfolio Manager — handoff notes (updated 2026-09-04, eighteenth pass)

## Data fix: 1137 Wayne St rent updated to $700/mo

Was $600 (Patrick's own stated figure — this is a family/personal
arrangement, no formal lease document). Updated to $700 per Patrick,
2026-09-04. Data-only change (`leases.rent_amount`), pushed directly to
both databases and to `seed.ts`; no redeploy needed since the app reads
Turso live.

## Eighteenth pass: fixed a prorated-first-month rent bug (1339 Division St)

Patrick caught that 1339 Division St's rent was wrong on the main dashboard
($592) but right on its property page — turned out the property page was
*also* wrong in the same way, just less obviously (the Units & Leases table
showed the real $1,800 lease rent right next to the wrong $592 summary
figure, so it read as "right" at a glance).

Root cause: the tenant moved in 2026-07-22, so the only PM statement rent
line on file for that property is a prorated ~10-day payment ($591.78)
against the July 31 period end — not a data error, just not a usable
"current monthly rent" figure. The PM-statement-first priority rule from
the fifteenth pass didn't know to distinguish a prorated partial month from
a real one.

Fix: `resolveCurrentRent()` in `src/lib/metrics.ts` (now shared by both the
main dashboard and the property page, replacing two separate `??` chains)
checks whether the most recent PM rent period falls in the same calendar
month a current lease started — if so, it's almost certainly a proration,
so the lease's full rent wins instead. 1339 Division St now shows $1,800
(marked "lease") in both places; spot-checked 1139 Division St and the
rest of the portfolio to confirm no other property's rent changed.


## Seventeenth pass: household equity share, 808 Maumee value correction, backlog cleanup

- **808 Maumee's value corrected to $141,000** (was $120,000, a Zillow
  estimate) — this is the real refi appraisal from the 6/26/2026 cash-out
  refi. `current_value_source` is now "appraisal", `current_value_as_of`
  "2026-06-26". Updated in `seed.ts` and pushed directly to both databases.
- **New "Patrick & Gina's Share" section on the main dashboard**, right
  below the existing portfolio-total rollup (now labeled "Total Portfolio
  (100%)" for clarity). Patrick pointed out the old single "Est. Equity"
  number was the whole portfolio at 100% ownership, not what he and Gina
  actually own — B2 Partners LLC is split 50/50 with Mike Bogan. The new
  section weights value/debt/equity by the household's real ownership % per
  entity, pulled from `entity_ownerships`/`owners.is_household` (100%
  everywhere except B2 Partners), via `getHouseholdPctByEntity()` in
  `src/lib/metrics.ts` — not hardcoded, so it stays correct if the split
  structure ever changes elsewhere. Currently: Total Portfolio Equity
  $1,147,273 vs. Patrick & Gina's Share $988,773 (the ~$158,500 difference
  is Mike's half of B2 Partners' equity). A note under the household section
  explains the gap and links to the B2 Partners page.
- **Backlog item split**: "Maintenance/rehab history rollup" is now closed
  out on the dashboard-view half (property detail pages ship full CapEx/
  Maintenance tables) — reworded to focus only on what's still open,
  backfilling PM statement "Repairs & Maintenance" line items into that
  same history.
- Deploy note: same as last pass — no GitHub yet, deployed with a Vercel
  token pasted in chat, plus a Turso *platform* API token this time (not a
  database token — those are two different token types on Turso; the
  platform token was used to mint a short-lived 1-hour database auth token
  via `POST /v1/organizations/boganp/databases/blt-portfolio/auth/tokens`,
  which then did the actual `UPDATE`). Worth remembering that distinction
  next time a database-level fix is needed outside the app itself.

## Sixteenth pass: property detail pages — click any property for full history

Patrick asked to make properties clickable and move detail off the main
dashboard, since it was getting crowded:

- **`/property/[id]`** — new page, linked from every row in the main
  dashboard's Properties table (the whole row is a link now, not just the
  address). Shows: a fuller financial summary (value/debt/equity/rent/PITI
  plus NOI, cap rate, cash-on-cash, DSCR, and appreciation — DSCR and the
  last three of those got pulled off the main table onto this page, since
  that's exactly what Patrick flagged as "too much on the dashboard");
  **Units & Leases** (per unit: bed/bath, tenant, lease status, rent,
  tenure since lease start, days until lease end — flagged amber under 60
  days); the current PM statement rent broken out **per unit label**, for
  multi-unit properties where the summed total on the dashboard doesn't
  tell the whole story (`getCurrentRentDetailByProperty()` in
  `src/lib/metrics.ts` now returns this breakdown, not just the sum);
  **Major Systems** (Roof / HVAC-Furnace / Water Heater) built by
  keyword-matching `maintenance_events.category`/`description`; **Rehab**
  summary (budget, spent, complete date, in-service date); and full
  **CapEx** and **Maintenance** history tables from `maintenance_events`
  (86 rows already in there from the VARE renovation-tab backfill, now
  finally surfaced in the UI — this closes out that item from the backlog).
- **Systems age is a real data gap, not solved this pass**: the 86
  `maintenance_events` rows are mostly undated free-text renovation-tab
  line items from the initial rehabs, not a structured "system + install
  date" log. The Major Systems cards say plainly when something matched by
  keyword but has no date ("on record, but no date entered") versus "not
  tracked yet" versus an actual dated entry (e.g. 1139 Division St's roof,
  2026-04-01). Worth a real pass of walking each property and logging
  install dates for roof/HVAC/water heater if Patrick wants that solid —
  right now it's best-effort surfacing of what's on file.
- Tenant names are blank for both 1139 Division St units (leases exist with
  rent/dates but no `tenant_name` on file) — same "data on file but
  incomplete" pattern as everywhere else, not a bug.
- Deploy note: still no GitHub connected (signup was blocked by GitHub's
  bot-detection for Patrick, unresolved as of this pass) — deployed with a
  one-time Vercel token Patrick generated and pasted in chat, used inline
  via env var and not written to any file. Revisit GitHub-based auto-deploy
  once that's sorted; until then every pass needs a fresh token from
  Patrick.

## Fifteenth pass: rent now sourced from PM statements, real property/LLC
## performance metrics, and the dashboard reorganized behind a menu

Patrick asked for a batch of dashboard/data changes. What shipped:

- **808 Maumee corrected to "Leased"** (was "Rehab") — rehab is complete and
  it's been leased since 2026-03-24 per the lease on file.
- **Current rent now sourced from PM statement transactions**, not just
  leases/underwriting estimates. `src/lib/metrics.ts`'s
  `getCurrentRentByProperty()` finds each property's single most recent PM
  statement period with a "Rent Income" line, sums every rent row at
  exactly that period (so multi-unit properties total correctly, including
  1139 Division St, where two units share one label string in the same
  statement), and that beats both the lease file and the VARE estimate in
  priority. **Bug caught during this pass, before it shipped**: an earlier
  version of this logic grouped by (property, label) and took each label's
  own latest occurrence — which meant a superseded label (e.g. 738 S.
  Washington's old 2025 lump-sum annual label) kept getting added back in
  every time, since it still had *a* "latest" row somewhere in the past.
  Caught by spot-checking the numbers against the raw PM data before
  deploying; fixed by finding the property's single most recent period
  across all labels and summing only rows at that period — a superseded
  label simply isn't part of the current period and drops out on its own.
  Monthly Rent on the Properties table now shows no "est." tag when PM data
  exists, "lease" when it's from a signed lease with no PM data yet, and
  "est." only when neither exists (VARE projection).
- **New performance metrics**, built from real PM statement income/expense
  data (Income − Operating Expense, excluding Capex/Adjustment), in
  `src/lib/metrics.ts`: NOI (monthly, averaged over however many months of
  actual statements exist per property and annualized), cap rate (annual
  NOI ÷ current value), DSCR (annual NOI ÷ annual PITI), cash-on-cash
  (annual (NOI − debt service) ÷ purchase price + rehab spent), and
  appreciation (current value ÷ purchase price − 1). Property-level ones
  (NOI/mo, cap rate, cash-on-cash, appreciation) are new columns on the main
  dashboard's Properties table. Deliberately did **not** build a formal IRR
  yet — there isn't a clean, complete cash-flow-plus-exit-value timeline per
  property with only a few months of PM statements on file, so an IRR would
  be more noise than signal right now. Worth revisiting once there's more
  history, or sooner as a rough estimate if that's more useful to you than
  waiting — let me know.
- **New nav menu + 4 secondary pages**, since more of these will come as we
  build out. `src/components/PageNav.tsx`'s `PageHeader` puts a "Menu"
  dropdown (plain `<details>/<summary>`, no JS framework) next to Sign Out
  on every page, linking to:
  - **`/llc-performance`** — the old "By Entity" value/debt/equity table,
    moved off the main dashboard, plus entity-level annual NOI, cap rate,
    and average monthly owner distributions (from PM statement "Owner Draw
    / Distribution" lines), and each entity's ownership split.
  - **`/b2-partners`** — B2 Partners LLC's own dashboard (our only outside
    partnership): value/debt/equity/NOI, the ownership split table (pulled
    live from `entity_ownerships`, not hardcoded — currently Mike Bogan 50%
    / Bogan-Rhineberger Household 50%) with equity and NOI broken out per
    owner, and the Capital Stack table (Acquisition Stack/Mike vs. Rehab
    Stack/Household) moved here as-is from the main dashboard.
  - **`/pm-statements`** — the "PM Statements Imported" table, moved as-is;
    a low-traffic reference page, not meant for regular use.
  - **`/backlog`** — a curated, human-readable dev backlog (not a raw dump
    of this file), grouped Now/Next, Later, and Ideas/Phase 2.
- **Main dashboard trimmed**: kept the 4-tile rollup and the Properties
  table (now with the new metric columns) and Pending Acquisitions; moved
  By Entity, B2 Partners Capital Stack, and PM Statements Imported to the
  pages above; **removed "Open Items From This Seed" entirely** (Patrick
  flagged it as odd) — the one signal worth keeping from it, "no PM
  assigned yet," now lives directly in the Properties table: the PM column
  shows "None" instead of "—" when nothing's assigned (previously this was
  a data gap note, buried; now it's just plainly visible in the table
  itself for Buckeye and 1137 Wayne St).
- Everything above is code/UI, not a data change — no reseeding or Turso
  data patch needed this pass, just a Vercel redeploy.


Patrick sent the full backlog of PM statements in two batches:

- **Batch 1 (13 files)**: T&H Realty for BLT Partners LLC (Jan-Jun 2026,
  monthly) and CRM Properties for BLT Washington, LLC (Jan-Jun 2026 monthly,
  plus the 2025 full-year annual).
- **Batch 2 (16 files)**: CRM Properties for B2 Partners, LLC (Jan-Jul 2026),
  BLT Mohawk, LLC (Jan-Jun 2026), and BLT Wildcat LLC (May-Jul 2026 — the
  successor entity 808 Maumee moved to; matched fine via the importer's
  existing renamed-entity fallback).

29 statements, 534 line items total, all imported into **both** the local
dev.db and the live Turso database (data-only change — no redeploy needed,
the live app picked it up immediately).

**Parser bug found and fixed**: CRM's annual (12-month) statements append a
"Cash Flow Property Comparison" table after the real TRANSACTION DETAILS
section — a per-property re-summary using account-code row labels (e.g.
"4000: Rent") with no TRANSACTION SUMMARY/DETAILS marker to signal the parser
it's a different report. `scripts/parse_pm_statement.py` was treating those
rows as more transactions, which would have double-counted every dollar in
the statement. Fixed by stopping at the literal line "Cash Flow Property
Comparison" (see the code comment there for why). Caught before anything
bad reached the database — verified the corrected 2025 BLT Washington annual
sums exactly to its stated beginning->ending balance delta ($2,224.62).
Every one of the 29 statements was reconciled the same way (line-item sum
vs. summary balance delta) before being trusted — all exact matches.

**Two categorization items still need Patrick's eyes** (line items were
imported either way, just flagged in `category_mappings` for review):
- "Sewer Clean out" (CRM) — mapped to Repairs & Maintenance, net $0 for the
  year so low-stakes either way. Already backfilled on both DBs.
- "CommissionPaid" (CRM, B2 Partners, Jan 2026, $1,000, no property tag, no
  description) — left UNMAPPED rather than guessed, since "commission"
  could mean a leasing commission or something else entirely and $1,000 is
  too much to guess at. Ask Patrick what this was.

**Process note for next batch**: identify each file's PM + entity by reading
its first page (or first couple of pages if multi-entity) with pdfplumber
before copying into data/raw/ — these owner-portal downloads all arrive
named generically ("Owner_Packet_MMDDYYYYMMDDYYYY.pdf", "_1"/"_2"/etc.
suffixes from browser download collisions when different PMs/entities
happen to produce the same filename) with no PM or entity name in the
filename itself. Always reconcile line-item sums against the statement's
own beginning/ending balance before trusting a batch — it would have caught
the Cash Flow Property Comparison bug immediately and should be standard
practice for every future load, not just when something looks off.

## Thirteenth pass: the app is live — no more screenshot review

The single biggest open item from every prior pass ("Auth + hosting... this is
still the biggest thing standing between 'Patrick reviews screenshots' and
'Patrick... actually opens this in a browser'") is done:

- **Live URL**: https://blt-portfolio.vercel.app — hosted on Vercel (Patrick's
  own account, `bltrei` team), SOC 2 Type 2 / ISO 27001 certified
  infrastructure, free HTTPS, region us-east (`iad1`).
- **Database**: moved off the local `dev.db` SQLite file to Turso
  (libSQL-compatible, SOC 2 certified), also on Patrick's own account. Group
  `blt-portfolio` in `aws-us-east-1`, database `blt-portfolio`. The DB client
  (`src/db/client.ts`) now uses `@libsql/client` + `drizzle-orm/libsql`
  instead of `better-sqlite3`, and reads `TURSO_DATABASE_URL` /
  `TURSO_AUTH_TOKEN` env vars — falls back to the local `dev.db` file when
  those aren't set, so local dev/seeding is unchanged. A second drizzle-kit
  config, `drizzle.config.turso.ts`, targets the Turso push separately from
  the local one.
- **Real login**: added a `users` table (bcrypt-hashed passwords, 5-attempt /
  15-minute lockout), a `/login` page, `/api/login` + `/api/logout` routes,
  and `src/proxy.ts` (this Next.js version renamed `middleware.ts` ->
  `proxy.ts` — see AGENTS.md) gating every other route behind a signed
  session cookie (`jose`/JWT, `AUTH_SECRET` env var). Patrick's account
  (`patrick`) is seeded via `scripts/seed_user.mjs <username> <password>`,
  which is deliberately separate from `seed.ts` since it handles a secret.
  Gina's account is not created yet — same script, whenever Patrick wants it.
- **What's NOT deployed**: `data/raw`, `data/processed`, and `scripts/` are
  excluded via `.vercelignore` — the live app only reads from Turso at
  request time, so there's no reason to upload Patrick's closing documents,
  ALTA settlements, and QuickBooks exports to Vercel's servers. `dev.db` is
  gitignored too. Keep it that way when adding new scripts.
- **To deploy a change**: from the project root,
  `vercel deploy --prod --token <token>` (token is in this session's history,
  not written to disk anywhere in the repo). Env vars are already set on the
  Vercel project as encrypted secrets (`vercel env ls` to see them, `vercel
  env add ... --sensitive` to add more). To push a schema change to
  production, run `drizzle-kit push --config drizzle.config.turso.ts --force`
  with `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` set, same as the local
  workflow but against the Turso config.
- **Network note for future Claude sessions working in this cloud sandbox**:
  reaching Vercel/Turso's APIs requires the org's egress allowlist (Admin
  settings -> Capabilities -> Code execution -> Network access -> Custom) to
  include `api.vercel.com`, `vercel.com`, `*.vercel.app`, `api.turso.tech`,
  `app.turso.tech`, and `*.turso.io` — all four were needed as separate
  additions since the management APIs and the actual data-plane hostnames
  are different domains. Also: Node's built-in `fetch` (used by
  `@libsql/client` and the Vercel CLI) silently ignores the sandbox's
  `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set in the environment —
  without it, Turso/Vercel calls hang or fail with a confusing "Host not in
  allowlist" error even once the domain IS allowlisted. Set that env var for
  any command that talks to either service from this sandbox.

## Twelfth pass: correction — the $3,600 roofing check is 1139 Division, not 1611 S. Washington; "Flooring" is 1339

Two same-day corrections to the eleventh pass, both from Patrick:

- The $3,600 Cesario Lopez Ramirez roofing check (from
  `BLT_Partners_LLC_Transaction_List_by_Date.csv`) is **1139 Division St**
  ("we replaced that roof this year too"), not 1611 S. Washington as I'd
  guessed last pass by pattern-matching it to the similar-looking B2
  Partners Cesario checks. Moved the `maintenance_events` row in `seed.ts`
  accordingly. The real 1611 S. Washington Cesario Lopez transaction is
  ~$3,000 and, per Patrick, genuinely hasn't shown up in any file provided
  yet — nothing to do here but wait for it and not assume the 1139 one was
  it.
- The generic "Flooring" line item ($2,940.32) in B2 Partners' rehab spend
  — the one piece left unmatched after the eleventh pass — is confirmed
  1339 Division too. Added as a `CONFIRMED_OVERRIDES` entry in
  `src/db/import-b2-partners-capital.ts` (matched on the exact-and-only
  "Flooring" memo in that CSV). **The B2 Partners rehab-spend reconciliation
  from last pass's open item is now fully closed**: all 57 transactions in
  the original $60,432 pile have a property, and 1339 Division's Rehab
  Stack shows the complete $60,432.

## Eleventh pass: GMB + Cesario Lopez confirmed for 1339, one Cesario check pulled out for 1611 S. Washington

Quick follow-up to the tenth pass's "held back, needs confirming" item.
Patrick confirmed: GMB Design & Contracting (3 checks, $42,800) and the
$4,000 Cesario Lopez roofing check are all 1339 Division rehab after all —
added as `CONFIRMED_OVERRIDES` entries in
`src/db/import-b2-partners-capital.ts` alongside the 1339 acquisition-wire
override from last pass. 1339 Division's Rehab Stack is now $57,492; the
only piece of the original $60,432 still unmatched is one generic
"Flooring" line item ($2,940.32) with no vendor name at all to go on.

**Exception, and a new data point:** Patrick also flagged a *different*
Cesario Lopez roofing check — about $3k — for 1611 S. Washington, and asked
whether it shows up yet. It doesn't, because it isn't in the B2 Partners
CSV at all: it's a $3,600 check (Check 8003, "Cesario Lopez Ramirez;
roofing labor and materials") in
`data/raw/BLT_Partners_LLC_Transaction_List_by_Date.csv` — a different
QuickBooks company file (BLT Partners LLC's shared checking, which also
covers BLT Buckeye/BLT Washington activity) that has no import pipeline at
all yet, unlike B2 Partners'. Rather than build a whole importer for one
transaction, I added it by hand as a `maintenance_events` row for 1611 S.
Washington in `seed.ts`. The rest of that file hasn't been mined — if
there's more property-specific capex buried in it the way this one check
was, a proper importer (mirroring `import-b2-partners-capital.ts`'s
pattern) would be the next step, similar in spirit to that script.

## Tenth pass: 1339 Division's acquisition wire confirmed, Wayne St + 1139 Division rent, rehab spend reassigned to 1339 Division

Four small, targeted fixes from Patrick's direction (2026-09-01), each sourced
from something already on file rather than a new document:

**1339 Division St's $136,043 acquisition wire is now in the Acquisition
Stack.** It was already matching to this property (the QBO memo says "...for
Division closing"), but QBO never categorized it (blank Split/account), so it
wasn't counted as a real acquisition-stack contribution. Patrick confirmed
it's genuine — it matches `1339_Division_Noblesville_ALTA_settlement_20251001.pdf`'s
"Balance Due FROM Buyer" line exactly ($136,042.72) — so
`src/db/import-b2-partners-capital.ts` now has a small `CONFIRMED_OVERRIDES`
list for exactly this kind of case: a specific transaction Patrick has
personally confirmed against a primary source, even though QuickBooks itself
still needs the entry categorized. It still counts toward the "needs QBO
cleanup" total (QBO itself is unchanged) but now also counts toward the real
stack total, and the dashboard's cleanup note wording was updated to reflect
that distinction instead of calling it "not yet reflected at all."

**1137 Wayne St now shows $600/mo rent** — Patrick's own stated figure, not
from a document (family/personal arrangement, no formal lease). Filed with a
note explaining the provenance so it doesn't get mistaken for a signed lease
later.

**1139 Division St (duplex) now shows $2,906/mo combined rent** — pulled from
the T&H Realty PM statement's July 2026 line items rather than a lease
document (none on file for either side): "Rent + Pet Rent (Renewal 26-27)"
$1,410/mo + "Rent (Month-to-Month)" $1,496/mo = $2,906, which matches that
statement's total income exactly. Two units added ("Side A"/"Side B" —
bookkeeping labels based on the PM report's lease-status text, not
necessarily the physical unit letters) since no tenant names are available
from a PM ledger export the way they are from an actual lease document.

**$10,692 of the "$60k unmatched rehab spend" reassigned to 1339 Division.**
Of the 57 QBO-categorized-but-property-less "1500 Construction in Progress"
transactions ($60,432 total), Patrick said to attribute anything from a
direct vendor (Lowe's, Home Depot, etc.) to 1339 Division, since that's the
property that was under active rehab during this spending window. Added a
keyword-matched `matchDirectVendorRehab()` to the import script — Lowe's,
Home Depot, Menards, Amazon, Wayfair, Habitat ReStore, and a few
less-obvious-but-still-POS-purchase patterns (Boone County Habitat, a
"roofing materials" transfer) all now tag to 1339 Division ($10,691.87 across
52 transactions). Deliberately held back two patterns that are contractor
LABOR payments rather than direct-vendor purchases — "GMB Design &
Contracting" (3 checks, $42,800) and a "Cesario Lopez" roofing check
($4,000) — plus one generic "Flooring" line item with no vendor name
($2,940.32). Those three stay unmatched (now $49,740 of the original
$60,432) since assigning $46,800 of contractor labor to one property based
on a "direct vendor" instruction felt like overreach — worth a quick
confirm from Patrick on which property(ies) that labor was actually for.

**Still open, per Patrick:** Kingston/2000 S Buckeye/4076 S 450 E and 615
Cherry haven't had their CRM Property Manager Reports loaded yet — once they
are, that's the source for real maintenance/capex history on those, same as
it now is for 1139 Division's rent.

## Ninth pass: real closing docs for Kingston/2000 S Buckeye/Hemlock, 808 Maumee's refi + lease, 5109 Mohawk's refi, and a correction on 738 S. Washington's rehab data

Patrick sent individual VARE files + ALTA settlement statements for 225 S
Kingston, 2000 S Buckeye, and 4076 S 450 E (explicitly superseding the
combined 3-property VARE file from last pass — deleted from `data/raw/`
and no longer referenced anywhere), the real closing package for 808
Maumee's cash-out refi plus its lease, the real closing package for 5109
Mohawk's refi (superseding the DRAFT VARE file's guessed terms), a
corrected 738 S. Washington VARE file, and 1339 Division's original
purchase ALTA settlement (a cash-out refi on that one is in process,
expected within ~30 days, not yet closed).

**225 S Kingston, 2000 S Buckeye, 4076 S 450 E — no longer estimates.**
Last pass I split the combined file's blended rent/tax/insurance three
ways by purchase-price share, labeled as rough estimates. That's now
replaced with real numbers: each property's own VARE file for rate/term/
rehab/rent, cross-confirmed against its ALTA settlement statement for the
actual loan amount and the tax/insurance figures straight off the
impounds lines (not projections). All three now show full (non-"partial")
PITI. Monthly Rent still shows "est." for these three (no lease on file
yet) but is now the property's own real underwriting projection, not a
proportional slice of someone else's blended number.

**808 Maumee's cash-out refi has actually closed** (6/26/2026, Cake
Mortgage Corp., $105,750 @ 6.75%/30yr) — moved from a "cash-financed, tax/
insurance only" loan row to a real loan with full PITI. Also added a real
lease from `808_Maumee_Kokomo_lease_20260324.pdf`: $1,500/mo, tenants
Lucas Rozumalski & Carly Fields, 3/24/2026–3/31/2027 — matches the VARE
projection exactly, so Monthly Rent for this property is now a real lease
figure (no more "est.").

**5109 Mohawk's refi closing package replaces the DRAFT VARE file.** Real
terms: $105,000 @ 6.75%/30yr (vs. the draft's guessed $103,600), P&I
$681.03/mo confirmed against the amortization schedule, tax $155.67/mo +
insurance $75.17/mo off the Closing Disclosure. current_balance updated to
$103,977.10 (the amortization schedule's balance nearest today's date,
2026-08-31/09-01), not the original loan amount.

**738 S. Washington: the $43,489 "rehab" I flagged last pass as a good
catch was actually my mistake, not stale data.** Patrick clarified the
Renovation tab's link was pointing at a different property's rehab data
left over from when he first created this VARE file — $0 rehab (turnkey
acquisition) was correct all along, matching the Inputs tab. He sent a
corrected master copy; `rehabCostBudget` reverted to 0 and the 17
maintenance_events rows from the bad data are gone from this rebuild
(extraction now correctly returns 0 items for this property). Lesson: a
detail tab isn't automatically more trustworthy than a summary cell —
worth sanity-checking either way when they disagree.

**1339 Division:** its own original-purchase ALTA settlement statement
gives a real property tax figure ($1,274.86/yr, from the county tax
proration line) — replaced the VARE file's $2,500/yr guess. Still cash-
financed; Patrick says a cash-out refi is in process and should close
within ~30 days, and the proceeds need to be split with Mike per the B2
Partners stack method once it does — flagged as needing refinement,
likely derivable from QBO per Patrick's note.

**Small capex backfill add-on:** the three newly-added individual VARE
files (Kingston/2000 S Buckeye/Hemlock) each have a small itemized
Renovation tab too (1 line item each, matching their modest $7,300/$6,800/
$4,000 Rehab Cost figures) — added to `scripts/extract_vare_renovation.py`'s
file list and pulled into `maintenance_events` along with everything else.

## Eighth pass: Monthly Rent fallback to VARE, capex/rehab backfill from Renovation tabs, combined 3-property file used (labeled as estimate)

Patrick's overnight note gave explicit permission to lean on the VARE files
more: use their rent/insurance/tax figures whenever nothing better exists
(he's been keeping the "Inputs" tab updated with actuals, not just
one-time projections), and pull capex/rehab clues from each file's
"Renovation" tab. Three things changed:

1. **Monthly Rent now falls back to the VARE projected rent** when a
   property has no active lease on file, shown with a small amber "est."
   label so it's visibly distinct from a real lease figure (same visual
   pattern as the existing PITI "partial" badge). Affects 738 S. Washington
   ($1,150), 808 Maumee ($1,500), 2000 S Buckeye ($1,374), 4076 S 450 E
   ($868), and 225 S Kingston ($1,663). `src/app/page.tsx`'s `getPortfolio()`
   computes `currentRent = leaseRent ?? underwriting?.projectedMonthlyRent`.

2. **Revisited the "combined 3-property file" decision from last pass.**
   Last time I declined to touch `VARE_3_properties_Kokomo_20250624.xlsx`
   (225 S Kingston + 2000 S Buckeye + 4076 S 450 E share one blended
   Purchase Price/Loan Amount/Tax/Insurance/Rent) at all, because the
   combined loan amount was ~$23k off from the three properties' actual
   combined balance. Patrick's new instruction is specifically about
   rent/tax/insurance, not the loan — those three apply per-property
   regardless of how financing shakes out — so I allocated just those three
   by purchase-price share (Kingston 115k / Buckeye 95k / Hemlock 60k of
   $270k combined) and entered them as clearly-labeled estimates
   (`underwriting_models.notes` and `loans.notes` both say "Estimate only:
   purchase-price-share..."). **The loan amount is still deliberately NOT
   allocated** — that's the one piece of this file I'm still not comfortable
   guessing at, so PITI for these three still shows "partial" (tax/insurance
   now filled in, but no P&I since rate/term/original amount are unknown).
   Worth flagging: the combined file's own purchase price ($300k) doesn't
   match the three properties' actual combined price ($270k) either, which
   is itself a sign these blended figures are rough — said so in the notes.

3. **Capex/rehab backfill from each VARE file's Renovation tab.** New
   `scripts/extract_vare_renovation.py` pulls every itemized "Yes" rehab
   line (component, cost, notes) plus any dated "off leash" catch-all draws
   out of the Renovation tab for all 6 VARE files that have one, into
   `data/processed/maintenance/vare_renovation_items.json` (kept in its own
   subfolder — a stray file directly in `data/processed/` gets picked up by
   `import-pm-reports.ts`'s glob and breaks it, learned that the hard way
   this pass). `src/db/import-maintenance-events.ts` loads it into
   `maintenance_events` (99 rows total, all `isCapex: true`, notes credit
   the source file). Each file's extracted total reconciles exactly to its
   own stated Grand Total, including 738 S. Washington, where the Inputs
   sheet's Rehab Cost cell said $0 but the Renovation tab's itemized total
   is $43,489 — used the Renovation tab's number (fixed
   `underwriting_models.rehabCostBudget` for that property from 0 to
   43489) since it's the more detailed, and per Patrick's actuals-tracking
   habit, likely more current figure. There's no dashboard section for
   maintenance_events yet — this pass just gets the data in as backfilled
   "clues," per the ask; a rollup UI would be a reasonable next step if
   useful.

## Seventh pass: 5 more VARE files — PITI now real for 6 of 8 mortgaged properties

Patrick sent 5 more VARE underwriting files and said he'll be back
"tomorrow" with current insurance/financing/closing docs — so this pass
processed everything usable from what's already on hand and left clear
notes on what's still needed, rather than waiting to ask.

**Now showing full (non-"partial") PITI**, both P&I and escrow filled in:
- **1611 S. Washington** — $986/mo (`VARE_1611_S_Washington_Kokomo_20250826.xlsx`)
- **738 S. Washington** — $769/mo (`VARE_738_S_Washington_Kokomo_20250728.xlsx`)
- **5109 Mohawk** — $907/mo (`VARE_5109_Mohawk_Kokomo_DRAFT_20250821.xlsx` —
  filename says DRAFT, and its loan amount ($103,600) is slightly *below*
  the current balance ($104,600), which shouldn't happen on a paying-down
  loan — worth double-checking against the real closing docs before fully
  trusting this one)

For all three, the loan amount in the VARE file lines up closely with the
current_balance already in the app (consistent with a loan that actually
closed and has since paid down a little), which is why I treated these as
the real financing rather than a pre-purchase pro forma — same reasoning
that worked for 1139 Division St last pass. Still labeled in `loans.notes`
as underwriting-file figures pending confirmation against actual closing
docs/mortgage statements, since that's what they are.

**Still "—" for PITI — two properties are genuinely still cash-financed,**
not missing data: 808 Maumee and 1339 Division St both show a $0 mortgage
balance in the portfolio tracker (no loan has closed yet on either). Their
VARE files (`VARE_808_Maumee_Kokomo_20260627.xlsx`,
`VARE_1339_Division_Noblesville_20260730.xlsx`) project a *future* refi —
now fully parsed into `underwriting_models` (purchase price, rehab budget,
ARV, projected rent/returns, and the planned refi terms noted in text) —
but deliberately NOT written into the `loans` table, since putting a
$105,750 or $156,000 loan balance on a property that's still cash-financed
would be wrong, not just imprecise.

**One file — `VARE_3_properties_Kokomo_20250624.xlsx` — covers 225 S
Kingston, 2000 S Buckeye, and 4076 S 450 E together**, with one blended
purchase price/loan amount/tax/insurance across all three, not broken out
per property. Deliberately did NOT attempt to split it: the combined loan
amount ($225,000) is already ~$23k off from these three properties' actual
combined current balance ($202,000) — a bigger gap than any of the
single-property files showed — so any per-property allocation would be
guessing on top of numbers that don't quite reconcile to begin with.
**This is the one open ask**: either a per-property breakdown of that
combined file, or the actual current loan/tax/insurance for these three
individually.

## Sixth pass: pulled real loan/insurance data out of BLT_Portfolio.xlsx

Went back through the per-property tabs in `BLT_Portfolio.xlsx` (there are 6:
Moon Lake, 1137 Wayne St, 1139 Division St, 110-112 S. Buckeye St, 5109
Mohawk, 1611 S. Washington) and pulled in everything usable for the new
PITI column — real numbers only, nothing guessed without saying so:

- **1139 Division St** — rate 7.1759%/30yr, $150,000 original amount (ties
  to the Oct-2024 cash-out refi mentioned in the portfolio notes, and
  matches this tab's own $150k balance). The tab states a combined monthly
  PTI of $1,577 rather than separate tax/insurance; backed out P&I
  (≈$1,015.74) and stored the $561.26 remainder as combined tax+insurance
  in `monthly_tax_escrow` — so the $1,577 total on the dashboard is real,
  even though it's flagged "partial" (the fields don't have a true tax-vs-
  insurance split).
- **1137 Wayne St** — rate 2.5%/15yr fixed is a real stated number, but the
  tab's own balance field was corrupted ("0434 as of 2024/11/03"), and it
  has no original loan amount on file — I estimated it at $158,996 (80% of
  the $198,745 purchase price, from the portfolio notes' "acquired with 20%
  down"). Flagged as an estimate in the loan's notes; would rather you
  confirm the real number than trust the algebra.
- **110-112 S. Buckeye St (BLT Flats)** — cash purchase, no loan at all
  ("Mortgage1: n/a" on its tab), so P&I is a genuine $0, not unknown. Does
  have a real annual insurance premium ($2,233, Berkshire Hathaway) → $186/mo.
  Still shows "partial" since there's no property tax figure for it yet.
- **Skipped 1611 S. Washington and 5109 Mohawk on purpose** — their tabs
  show 11.49%/12-month hard money terms, but the portfolio notes say both
  got cash-out refi'ed into DSCR loans in Aug 2025. Carrying in the hard
  money numbers would've been actively wrong (stale), so both stayed blank
  pending the current DSCR loan's real rate/term/amount.
- Also refined the PITI logic itself: a cash-purchase property (no loan
  row, or a loan row with no balance) now computes P&I as a known $0
  instead of showing "—" as if the data were simply missing — those are
  different situations and the dashboard now tells them apart.
- No tab or VARE file at all yet for: 738 S. Washington, 808 Maumee, 2000 S
  Buckeye, 4076 S 450 E (Hemlock), 225 S Kingston, 1339 Division St.

## Fifth pass: Monthly Rent + Monthly PITI columns on the Properties table

Added two columns to the dashboard's Properties table, as requested:

- **Monthly Rent** — sums each property's units' current lease (rent + pet
  rent, skipping ended leases, using the most-recently-started lease per
  unit if more than one is on file). Real numbers for the 3 properties with
  lease documents loaded (1611 S. Washington $1,300, 5109 Mohawk $1,400,
  1339 Division St $1,800); blank ("—") elsewhere because there's no lease
  on file yet, not because rent is $0 — don't read a blank as vacant.
- **Monthly PITI** — this one hit a real data gap: none of the 8 mortgaged
  properties have interest rate, term, or original loan amount loaded (only
  current balance), and there's no property tax or insurance data anywhere
  in the app. I added `monthly_tax_escrow` / `monthly_insurance_escrow`
  columns to the `loans` table and a standard fixed-rate amortization
  calculation for P&I (`monthlyPrincipalAndInterest()` in `page.tsx`), but
  with no inputs yet, every property shows "—" for PITI. You confirmed
  build-it-now-fill-in-later rather than pausing to collect the numbers.
  **To make this real**: for each loan, I need the original loan amount,
  interest rate, and term (from the loan documents/DSCR closing package),
  plus monthly tax and insurance escrow (from the mortgage statement's
  escrow breakdown, if escrowed — if not escrowed, the annual tax bill and
  insurance premium divided by 12 works too). Once even one loan has rate +
  term + original amount, P&I will show for that property; escrow amounts
  are separate and a property can show a "partial" P&I-only PITI if it has
  loan terms but no escrow figures yet.
- Rebuilt `dev.db`'s `loans` table in place via `drizzle-kit push` (additive
  columns, so nothing was lost — all 5 imported PM statements and B2
  Partners' capital stack data are still there).

## Fourth pass: PM report import pipeline (the next-highest-value item from last time)

Built the actual pipeline, not just a design — using the real CRM Properties
and T&H Realty owner statements you'd already shared (2 annual xlsx exports,
3 PDF statements), not sample/invented data.

- **`scripts/parse_pm_statement.py`** — converts one PM statement (`.xlsx` or
  `.pdf`, either PM) into clean intermediate JSON: entity, period, summary
  totals, category totals, and line items grouped by property. Handles both
  formats' real-world messiness: CRM's xlsx export puts "Transaction
  Summary" and "Transaction Details" on two separate sheets, not two
  sections of one sheet; PDF statements wrap rows across page breaks and
  mix in unrelated "Bill" receipt pages; the CRM Owner Packet PDF turned out
  to be one entity's statement plus its Bill pages, not a true multi-entity
  packet, but the parser still splits on repeated entity-name banners in
  case a real multi-entity packet shows up later. Run per source file:
  `python3 scripts/parse_pm_statement.py data/raw/<file> --pm "<CRM Properties|T&H Realty Services>" [--entity "<name>"] --out-dir data/processed`
  (`--entity` optional for PDFs — it can usually detect the entity name from
  the statement itself; xlsx files don't print it, so pass it explicitly).
- **`src/db/import-pm-reports.ts`** — loads every JSON in `data/processed/`
  into `pm_reports` / `pm_report_line_items`: matches entity_label to an
  `entities` row (tolerant of punctuation and of properties that moved to a
  renamed entity), matches each line item's property label to a `properties`
  row (tolerant of unit suffixes, directionals like "S", "Dr" vs "Drive"),
  and maps each PM's raw category wording to `normalizedCategoryId` via
  `category_mappings`, auto-guessing and flagging new mappings by keyword
  when one doesn't exist yet rather than leaving rows uncategorized. Skips
  a statement it's already imported (same PM + entity + period), so it's
  safe to re-run after dropping more statements into `data/raw/`.
  Run with: `npx tsx src/db/import-pm-reports.ts`
- Added `propertyId` to `pm_report_line_items` (nullable FK to
  `properties`) alongside the existing free-text `propertyLabel` — the
  importer already does the address matching, so line items can be rolled
  up by property directly instead of re-parsing the label text every time.
- Imported the 5 real statements you'd shared: CRM annual 2025 statements
  for BLT Mohawk LLC and B2 Partners LLC, T&H annual 2025 and July 2026
  statements for BLT Partners LLC, and the CRM July 2026 packet for BLT
  Washington LLC. 305 line items total, all 305 categorized, only a handful
  of property labels that stayed unmatched (all legitimate entity-level
  owner draws/contributions with no property tied to them, not mismatches
  — verified by summing amounts by property against each statement's own
  totals). Three raw category strings got auto-guessed mappings this run
  (CRM's "Leasing Fee", "Lock Change Expense", "M2M Fee to Owner") — worth
  a quick sanity check against `category_mappings` next time you're in
  there, though the guesses look right.
- Dashboard: new "Property Manager Statements Imported" section — one row
  per statement imported (entity, PM, period, income/expenses/ending
  balance), with a line-item/category-coverage note underneath so it's
  obvious this is 5 statements' worth, not the full history yet.
- **Note on the dev database**: I rebuilt `dev.db` from scratch this pass
  (schema.ts changed — the new `propertyId` column — and there's no
  migration history yet, just `drizzle-kit push`). If you ever see data
  that looks reset, that's why; the seed + both import scripts are all
  idempotent/re-runnable in order (`seed.ts` → `import-b2-partners-capital.ts`
  → `import-pm-reports.ts`) so nothing here requires you to redo any manual
  work.
- Also ran into a real gotcha worth flagging: an old `next start` process
  from a previous session was still holding port 3311 with a stale build,
  so the new dashboard section silently didn't show up until that process
  was killed. If a screenshot/preview ever looks stale after a change,
  that's the first thing to check.

## Third pass: BLT Flats/Wildcat tax status + B2 Partners capital stack

- Fixed: BLT Flats LLC and BLT Wildcat LLC are both taxed as partnerships,
  not S-corps (you corrected this — my earlier guess was wrong).
- Built a real B2 Partners Acquisition Stack / Rehab Stack ledger from the
  actual QuickBooks transaction export (`data/raw/B2_Partners_LLC_Transaction_List_by_Date.csv`,
  now saved into the project so this is reproducible), not a guess:
  - New `capital_contributions` table + `src/db/import-b2-partners-capital.ts`
    parses every checking-account transaction, matches it to a property by
    memo text, classifies it as Acquisition (1100 Buildings) or Rehab (1500
    Construction in Progress), and tags who contributed the capital (Mike vs.
    the household) from the QBO partner-contribution accounts.
  - New dashboard section shows the resulting per-property stack totals.
  - Bottom line so far: Mike has contributed $242,000 total (Acquisition
    Cash), the household $65,020 (Rehab Cash). Rehab spend posted to date
    ($60,432) is within that $65,020 — a reasonable sanity check, though not
    proof everything's right.
  - You mentioned some QBO transactions still need categorizing — I found
    10 of them (totaling $145,899), the biggest being the entire $136,043
    closing wire for 1339 Division St, which currently isn't posted to
    "1100 Buildings" at all, so that property's Acquisition Stack shows as
    empty above even though the money clearly went out. Sent you a separate
    workbook (`B2_Partners_QBO_Cleanup_and_Stack_Summary.xlsx`) with all 10,
    my best-guess suggested category for each (based on matching later,
    already-categorized transactions with identical amounts), and a
    confidence level — reconcile these in QuickBooks and the stack numbers
    in the app will sharpen up. Rehab spend ($60,432 across 57 transactions)
    is mostly generic Lowe's/Home Depot/contractor charges with no property
    named in the memo, so it currently shows as portfolio-wide rather than
    per-property — that's a real limitation of bank-feed data, not a bug;
    fixing it means either tagging rehab expenses by property in QuickBooks
    going forward, or accepting a blended rehab number.

## What's here

A working Next.js + SQLite app with a real data model for the BLT portfolio,
seeded with your actual current structure, and a dashboard that renders it.
This is the foundation, not a finished app — see "Not built yet" below.

- `src/db/schema.ts` — the full data model (entities, properties, ownership
  history, loans, leases, maintenance events, vendors, property managers,
  PM report line items + category normalization, underwriting models).
- `src/db/seed.ts` — seeds the DB with your real entities/properties/loans/
  leases/PM assignments, now corrected against the quitclaim deeds, the BLT
  Flats operating agreement, and the sample leases you sent.
- `src/app/page.tsx` — the dashboard (portfolio rollup, by-entity table,
  property table, pending acquisitions, open-items list).
- `dev.db` — the SQLite database file.

To run it: `npm run dev` (or `npm run build && npm run start`).

## What changed in this pass (from your corrections)

- **Moon Lake (personal residence) removed entirely** — not seeded, doesn't
  appear anywhere, not just filtered from totals.
- **615 Cherry moved out of the property list** into its own "Pending
  Acquisitions" section — it's under contract (target close 9/17/2026), not
  owned real estate yet, and is excluded from all portfolio totals.
- **Entity dates corrected from the recorded deeds**: both the Buckeye→Flats
  and Mohawk→Wildcat property transfers were executed 4/17/2026 (recorded
  4/29/2026, Howard County), and both routed through you and Gina personally
  on the way — I modeled that as an explicit (if momentary) ownership step
  rather than a direct LLC-to-LLC move, so the audit trail is real. BLT Flats
  LLC and BLT Wildcat LLC operating agreements are both effective 3/16/2026,
  50% Patrick / 50% Gina.
- **1339 Division St status corrected** — the portfolio workbook had it
  mid-rehab as of Dec 2025, but the lease you sent shows it's now leased
  (tenants moved in 7/22/2026). Updated.
- **Three real leases added**: 5109 Mohawk (Bystrom, $1,400/mo, through
  7/31/2026), 1611 S. Washington (Robertson, $1,300/mo, through 8/31/2026),
  1339 Division St (Janes/Mills, $1,800/mo, through 7/31/2027, landlord of
  record B2 Partners LLC per the lease). Deposit amounts and provided
  appliances captured too — that appliance list is a first seed for the
  maintenance/systems module.

## Where the current values came from

Straight from your `BLT_Portfolio.xlsx` master tracker — it already listed a
"current est value" and "source" per property (a mix of Zillow, recent
appraisals, and your own estimates like "PB estimate" for the Buckeye
building). Nothing was estimated independently.

**Phase 2 idea you raised, noted for later**: let you enter your own estimate
per property, and separately have the app try to determine a value on its
own (e.g. pulling an automated valuation from a source like Zillow/Redfin, or
a rent-based approach). Flagging two things to think about when we get
there: most free automated-valuation sources don't offer a clean API for
this kind of use, and Kokomo/Noblesville off-market rentals are exactly the
property type AVMs tend to be least accurate on — so this will likely end up
being "a second data point to compare against your own estimate," not a
replacement for it. Not started.

## Open items / things to still confirm

- No property manager set up yet for the Buckeye/Flats building (still under
  rehab) — expected, just flagged in the app's open-items list so it's not
  mistaken for a bug later.
- B2 Partners' per-property Acquisition Stack / Rehab Stack dollar amounts
  (Section 4.3 of that operating agreement references per-property capital
  schedules) — haven't seen those yet, needed before the app can show real
  pre-first-refi stack balances.
- Loan/PITI data — most of what was open here is now resolved (ninth
  pass): Kingston, 2000 S Buckeye, 4076 S 450 E, 808 Maumee, and 5109
  Mohawk all now have real closing-doc-confirmed loan terms and full
  PITI. What's left: confirm the estimated $158,996 original loan amount
  for 1137 Wayne St (still an inference from "20% down" in the portfolio
  notes, not a closing doc); confirm 1611 S. Washington and 738 S.
  Washington's loans (currently VARE-underwriting-file figures) against
  actual mortgage statements when convenient; and 1339 Division St's
  cash-out refi, in process and expected to close within ~30 days of
  2026-08-31 — once it closes, needs real loan terms plus the Mike-split
  worked out per the B2 Partners stack method (Patrick flagged this as
  something QBO should help with).
- Monthly Rent shown as "est." (738 S. Washington, 2000 S Buckeye, 4076 S
  450 E, 225 S Kingston) is a VARE underwriting projection, not a signed
  lease — replace with real lease data as it's entered. 808 Maumee, 1137
  Wayne St, and 1139 Division St now all show real (non-"est.") rent
  figures (tenth pass) — Wayne St from Patrick directly, 1139 Division from
  the T&H Realty PM statement, 808 Maumee from its lease document.
- B2 Partners rehab spend: **fully resolved (twelfth pass)**. GMB Design &
  Contracting, the $4,000 Cesario Lopez check, and the generic "Flooring"
  line item ($2,940.32) are all confirmed 1339 Division. Every one of the
  57 transactions in the original $60,432.19 pile now has a property — $0
  unmatched.
- Maintenance/capex history for Kingston, 2000 S Buckeye, 4076 S 450 E, and
  615 Cherry — no CRM Property Manager Reports loaded for these yet (per
  Patrick, tenth pass); that's the source once they're in.
- `data/raw/BLT_Partners_LLC_Transaction_List_by_Date.csv` (BLT Partners
  LLC's shared checking, covering BLT Buckeye/BLT Washington activity too)
  has no import pipeline yet — only one transaction from it has been pulled
  out by hand: a $3,600 roofing check to Cesario Lopez Ramirez, confirmed
  (twelfth pass) as **1139 Division St**, not 1611 S. Washington as first
  guessed. The real ~$3,000 Cesario Lopez transaction for 1611 S.
  Washington is still outstanding — Patrick confirmed it's real but hasn't
  shown up in any file provided yet. Worth a proper importer mirroring
  `import-b2-partners-capital.ts` if there's more property-specific spend
  buried in there.

## Not built yet (next phases)

1. **PM report import — pipeline built, needs more statements fed in.** The
   parser + importer work end-to-end (see above); what's imported so far is
   just the 5 sample statements you already shared. As monthly CRM/T&H
   statements come in, drop them in `data/raw/`, run
   `python3 scripts/parse_pm_statement.py ...` per file, then
   `npx tsx src/db/import-pm-reports.ts` — no code changes needed unless a
   statement's raw category wording or layout is genuinely new.
2. **Remaining lease data** — Wayne St, 738 S. Washington, the Buckeye/Flats
   building, 2000 S Buckeye, Hemlock, and Kingston don't have lease
   documents on file yet.
3. **Maintenance/rehab history** — 99 rows now backfilled from the 6 VARE
   files' Renovation tabs (see eighth pass), but there's no dashboard UI for
   `maintenance_events` yet — worth a rollup section if useful. The PM
   statement line items already imported (Repairs & Maintenance category)
   are another real source for this and haven't been backfilled into
   `maintenance_events` yet — the raw statement text often has enough detail
   (unit, work order #, description) to do that as a later step.
4. **Bank balance / autopay monitoring** — not started.
5. **Auth + hosting** — still local-only, no login. This is still the
   biggest thing standing between "Patrick reviews screenshots" and "Patrick
   and Gina actually open this in a browser" — worth prioritizing once the
   PM import and lease data are further along.
6. **QuickBooks Online integration** — phase 2, as agreed.
7. **Automated property value estimation** — phase 2 idea noted above.

## Suggested next step

Feed more real PM statements through the new pipeline (drop files in
`data/raw/`, rerun the two scripts) to get from "5 sample statements" to
real monthly coverage, and/or start backfilling lease data for the
properties that don't have lease documents on file yet. Hosting (so this
stops being screenshot-only) is the other open thread — worth deciding when
to jump to it rather than continuing to iterate locally.
