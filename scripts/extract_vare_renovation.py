#!/usr/bin/env python3
"""
Pull the itemized rehab component checklist out of each VARE file's
"Renovation" tab — every row marked Yes/yes with a nonzero Reno Cost — into
one JSON file src/db/import-maintenance-events.ts can load into
maintenance_events. This is real per-line-item rehab spend with notes (what
was actually done and why), not just the lump-sum rehab budget already in
underwriting_models.

Run with: python3 scripts/extract_vare_renovation.py
"""
import json
import re
from pathlib import Path
import openpyxl


def parse_off_leash_date(label):
    """'off leash 12/22/24' -> '2024-12-22' (or None if no date found)."""
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", str(label))
    if not m:
        return None
    mm, dd, yy = m.groups()
    yyyy = f"20{yy}" if len(yy) == 2 else yy
    return f"{yyyy}-{int(mm):02d}-{int(dd):02d}"

RAW_DIR = Path(__file__).parent.parent / "data/raw"
# Lives in its own subfolder, not directly in data/processed/, because
# import-pm-reports.ts globs every *.json directly under data/processed/ and
# expects each to be a PM statement — a stray file there breaks that import.
OUT_PATH = Path(__file__).parent.parent / "data/processed/maintenance/vare_renovation_items.json"

# VARE filename -> property address as seeded in src/db/seed.ts
FILES = {
    "VARE_1611_S_Washington_Kokomo_20250826.xlsx": "1611 S. Washington",
    # Corrected 2026-08-31: this file's Renovation tab used to have a broken
    # link pointing at a different property's rehab data (Patrick's mistake
    # when he first created it, since fixed in his master copy) — it now
    # correctly extracts to zero line items, matching the $0 Rehab Cost this
    # property always had on its Inputs tab (turnkey acquisition).
    "VARE_738_S_Washington_Kokomo_20250728.xlsx": "738 S. Washington",
    "VARE_5109_Mohawk_Kokomo_DRAFT_20250821.xlsx": "5109 Mohawk",
    "VARE_808_Maumee_Kokomo_20260627.xlsx": "808 Maumee",
    "VARE_1339_Division_Noblesville_20260730.xlsx": "1339 Division St",
    "VARE_615_Cherry_Noblesville_20260815.xlsx": "615 Cherry",
    # Individual VARE files for these three, replacing the withdrawn combined
    # VARE_3_properties_Kokomo_20250624.xlsx.
    "VARE_225_S_Kingston_Kokomo_20250924.xlsx": "225 S Kingston",
    "VARE_2000_S_Buckeye_Kokomo_20250731.xlsx": "2000 S Buckeye",
    "VARE_4076_S_450E_Hemlock_20250731.xlsx": "4076 S 450 E",
}


def extract(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    if "Renovation" not in wb.sheetnames:
        return []
    ws = wb["Renovation"]
    items = []
    for row in ws.iter_rows(values_only=True):
        if not row:
            continue
        component, did_it = row[0], row[1]
        cost = row[7] if len(row) > 7 else None

        # Itemized checklist rows: Component name, "Yes"/"yes", ..., Reno Cost.
        if component and isinstance(did_it, str) and did_it.strip().lower() == "yes" and cost:
            notes = row[9] if len(row) > 9 else None
            items.append({
                "category": str(component).strip(),
                "cost": round(float(cost), 2),
                "notes": notes.strip() if isinstance(notes, str) else None,
                "date": None,
            })
            continue

        # Catch-all "off leash" draws: cost paid outside the itemized
        # checklist, dated in a free-text label like "off leash 12/22/24" in
        # column D (index 3), sometimes with a short description in column A.
        label = row[3] if len(row) > 3 else None
        if label and "off leash" in str(label).lower() and cost:
            date = parse_off_leash_date(label)
            items.append({
                "category": str(component).strip() if component else "General Contractor Draw",
                "cost": round(float(cost), 2),
                "notes": f"Draw outside the itemized rehab checklist ({label})",
                "date": date,
            })
    return items


def main():
    out = []
    for fname, address in FILES.items():
        path = RAW_DIR / fname
        if not path.exists():
            print(f"Skipping {fname}: not found in data/raw/")
            continue
        items = extract(path)
        out.append({"property_address": address, "source_file": fname, "items": items})
        print(f"{fname} -> {address}: {len(items)} line items, ${sum(i['cost'] for i in items):,.2f} total")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
