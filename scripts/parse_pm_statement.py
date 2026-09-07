#!/usr/bin/env python3
"""
Parse a PM (property manager) owner statement — CRM Properties or T&H Realty
Services, as either .xlsx or .pdf — into a normalized intermediate JSON file
that src/db/import-pm-reports.ts can load without needing to know anything
about spreadsheet layouts or PDF text wrapping.

Both PMs' statements share the same logical shape once you strip formatting:
  - A "Transaction Summary" table: raw category -> (statement period $, YTD $)
  - A "Transaction Details" list: chronological line items, grouped under
    property-address header lines (or an entity-level block with no address
    header, for owner contributions/draws not tied to one property).

Usage:
  python3 scripts/parse_pm_statement.py <input.xlsx|input.pdf> \
      --pm "CRM Properties" --entity "BLT Mohawk LLC" \
      --out data/processed/<name>.json

  --period-start / --period-end / --statement-date are optional overrides;
  by default the script infers the period from the Beginning/Ending Balance
  rows (annual CRM statements) or from the file's own summary header (PDFs).
"""
import argparse
import json
import re
import sys
from pathlib import Path

MONEY = r"\$?\s?\(?-?[\d,]+\.\d{2}\)?"


def to_amount(s):
    """'$1,234.56' -> 1234.56 ; '$ (1,234.56)' or '(1,234.56)' -> -1234.56 ; '' -> None"""
    if s is None:
        return None
    s = str(s).strip()
    if s == "" or s.lower() == "nan":
        return None
    neg = "(" in s
    s = re.sub(r"[()$,\s]", "", s)
    if s == "":
        return None
    try:
        val = float(s)
    except ValueError:
        return None
    return -val if neg else val


def to_iso_date(s):
    """'MM-DD-YYYY' -> 'YYYY-MM-DD'"""
    if not s:
        return None
    m = re.match(r"(\d{2})-(\d{2})-(\d{4})", s.strip())
    if not m:
        return None
    mm, dd, yyyy = m.groups()
    return f"{yyyy}-{mm}-{dd}"


PROPERTY_HEADER_RE = re.compile(r"^(?P<addr>.+?,\s*[A-Za-z ]+,?\s*[A-Z]{2}\s+\d{5})\s*(\(\s*Reserve:\s*\$?[\d,.-]+\s*\))?\s*$")
NET_RE = re.compile(r"^Net\s?\$")
BALANCE_RE = re.compile(r"^(Beginning|Ending)\s+Balance\b")
STATEMENT_NET_RE = re.compile(r"^Statement\s+Net")
TOTAL_ROW_RE = re.compile(r"^Total\s+(Income|Expenses|Adjustments)$", re.I)
SECTION_LABEL_RE = re.compile(r"^(Income|Expenses|Adjustments)$", re.I)

# raw_category is everything before the first " - " in the description.
def split_category(desc):
    if " - " in desc:
        cat, rest = desc.split(" - ", 1)
        return cat.strip(), rest.strip()
    return desc.strip(), None


# ---------------------------------------------------------------------------
# XLSX parsing (CRM's exported "Transaction Summary" / "Transaction Details")
# ---------------------------------------------------------------------------

def parse_xlsx(path):
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    # This export format puts the summary and the detail transactions on two
    # separate sheets, named exactly "Transaction Summary" / "Transaction
    # Details" — not two sections of one sheet.
    all_rows = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        for row in ws.iter_rows(values_only=True):
            all_rows.append((sheet_name, row))

    category_totals = []
    line_items = []
    summary = {}
    entity_label_from_rows = None

    current_property = None

    for sheet_name, row in all_rows:
        section = "summary" if sheet_name == "Transaction Summary" else ("details" if sheet_name == "Transaction Details" else None)
        if section is None:
            continue
        cells = [c for c in row]
        first = str(cells[0]).strip() if cells[0] is not None else ""
        if not first:
            continue
        if first == "Account" or first == "Description":
            continue  # header row of whichever table we're in

        if section == "summary":
            if SECTION_LABEL_RE.match(first):
                continue
            period_val = to_amount(cells[1]) if len(cells) > 1 else None
            ytd_val = to_amount(cells[2]) if len(cells) > 2 else None
            if first in ("Beginning Balance", "Ending Balance"):
                summary[("beginning_balance" if first.startswith("Beg") else "ending_balance")] = period_val
                continue
            if TOTAL_ROW_RE.match(first):
                key = TOTAL_ROW_RE.match(first).group(1).lower()
                summary[f"total_{key}"] = period_val
                continue
            category_totals.append({"raw_category": first, "statement_period": period_val, "ytd": ytd_val})

        elif section == "details":
            date_raw = cells[1] if len(cells) > 1 else None
            inc = to_amount(cells[2]) if len(cells) > 2 else None
            dec = to_amount(cells[3]) if len(cells) > 3 else None
            date_iso = to_iso_date(str(date_raw)) if date_raw else None

            if BALANCE_RE.match(first) or NET_RE.match(first) or STATEMENT_NET_RE.match(first):
                continue
            m = PROPERTY_HEADER_RE.match(first)
            if m:
                current_property = m.group("addr").strip()
                continue
            if date_iso is None and inc is None and dec is None:
                # Entity name label row (no address, no date/amounts) — resets
                # to entity-level (not property-specific) line items.
                entity_label_from_rows = entity_label_from_rows or first
                current_property = None
                continue

            amount = (inc or 0) - (dec or 0)
            raw_cat, desc = split_category(first)
            line_items.append({
                "property_label": current_property,
                "raw_category": raw_cat,
                "description": desc,
                "date": date_iso,
                "amount": round(amount, 2),
            })

    return summary, category_totals, line_items, entity_label_from_rows


# ---------------------------------------------------------------------------
# PDF parsing (CRM Owner Packet / T&H owner statement)
# ---------------------------------------------------------------------------
#
# A PDF may be a single owner statement (T&H) or a multi-entity "packet"
# (CRM emails one PDF containing several entities' statements back to back,
# with unrelated "Bill" receipt pages interleaved). So PDF parsing works in
# two passes: first split the raw lines into one segment per entity (each
# segment starts at the entity-name banner CRM/T&H print twice in a row at
# the top of every statement), then run the same summary/detail extraction
# on each segment independently.

ENTITY_BANNER_RE = re.compile(r"^[A-Z][A-Za-z0-9&.'\- ]*,?\s+LLC\.?$")
SUMMARY_LINE_RE = re.compile(
    r"^(?P<cat>[A-Za-z][A-Za-z /&]*?)\s+\$\s?(?P<period>\(?[\d,]+\.\d{2}\)?)\s+\$\s?(?P<ytd>\(?[\d,]+\.\d{2}\)?)\s*$"
)
STMT_PERIOD_RE = re.compile(r"(\d{2}-\d{2}-\d{4})\s+to\s+(\d{2}-\d{2}-\d{4})")
STMT_DATE_LINE_RE = re.compile(r"to\s+\d{2}-\d{2}-\d{4}\s+(\d{2}-\d{2}-\d{4})\s*$")
DATE_TOKEN_RE = re.compile(r"\b\d{2}-\d{2}-\d{4}\b")
MONEY_TOKEN_RE = re.compile(r"\$\s?\(?[\d,]+\.\d{2}\)?")
BILL_PAGE_MARKERS = ("Itemized Charges", "Bill has been paid", "Payee Reference", "Bill Date")


def split_pdf_into_entity_segments(lines):
    """Find every 'ENTITY NAME' banner repeated twice in a row (how CRM/T&H
    print the entity name at the top of each statement) and slice the line
    list into one segment per entity. A PDF with only one such banner (or
    none — fall back to the whole file as a single unlabeled segment)."""
    starts = []
    for i in range(len(lines) - 1):
        a, b = lines[i].strip(), lines[i + 1].strip()
        if a and a == b and ENTITY_BANNER_RE.match(a) and "Owner Statement" not in a:
            starts.append((i, a))
    if not starts:
        return [(None, lines)]
    segments = []
    for idx, (start_i, name) in enumerate(starts):
        end_i = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        segments.append((name, lines[start_i:end_i]))
    return segments


def parse_pdf_segment(lines):
    header_text = "\n".join(lines[:15])
    period_start = period_end = statement_date = None
    m = STMT_PERIOD_RE.search(header_text)
    if m:
        period_start, period_end = to_iso_date(m.group(1)), to_iso_date(m.group(2))
    dm = STMT_DATE_LINE_RE.search(header_text)
    if dm:
        statement_date = to_iso_date(dm.group(1))

    category_totals = []
    line_items = []
    summary = {}
    current_property = None
    in_details = False
    in_bill_page = False
    saw_income_or_expense_header = False

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if any(marker in line for marker in BILL_PAGE_MARKERS):
            in_bill_page = True
            continue
        if line == "TRANSACTION DETAILS":
            in_details = True
            in_bill_page = False
            current_property = None
            continue
        if line == "TRANSACTION SUMMARY":
            in_details = False
            in_bill_page = False
            continue
        if line == "Cash Flow Property Comparison":
            # CRM's annual (12-month) statements append a per-property
            # "Cash Flow Property Comparison" report after the real
            # TRANSACTION DETAILS section, with no TRANSACTION
            # SUMMARY/DETAILS marker of its own. It's a by-property
            # re-summary of numbers already captured above (account-code
            # rows like "4000: Rent", plus "Total Income"/"Net Operating
            # Income"/etc. subtotal rows) — parsing it as more transaction
            # line items would double-count every dollar in the statement.
            # Nothing after this line is real transaction data, so stop.
            break
        if line in ("Description Date Increase Decrease Balance", "Account Statement Period Year to Date"):
            continue
        if re.match(r"^\d+ of \d+$", line):
            continue
        if in_bill_page:
            continue

        if not in_details:
            if SECTION_LABEL_RE.match(line):
                saw_income_or_expense_header = True
                continue
            # The one-line-per-amount "SUMMARY" box some CRM statements print
            # above the category table (no YTD column, so SUMMARY_LINE_RE
            # below won't match it): "Total Income (+)   $2,390.00", etc.
            if line.startswith("Beginning Balance") or line.startswith("Ending Balance"):
                amts = MONEY_TOKEN_RE.findall(line)
                if amts:
                    key = "beginning_balance" if line.startswith("Beginning") else "ending_balance"
                    summary[key] = to_amount(amts[0])
                continue
            box_m = re.match(r"^Total\s+(Income|Expenses|Adjustments)\s*\([+-]\)\s+(\$\s?\(?[\d,]+\.\d{2}\)?)", line)
            if box_m:
                summary[f"total_{box_m.group(1).lower()}"] = to_amount(box_m.group(2))
                continue
            box_dist_m = re.match(r"^Total Distribution:\s*(\$\s?\(?[\d,]+\.\d{2}\)?)", line)
            if box_dist_m:
                summary["total_distribution"] = to_amount(box_dist_m.group(1))
                continue
            tm = TOTAL_ROW_RE.match(line)
            sm = SUMMARY_LINE_RE.match(line)
            if tm and sm:
                key = tm.group(1).lower()
                summary[f"total_{key}"] = to_amount(sm.group("period"))
                continue
            if sm and saw_income_or_expense_header:
                category_totals.append({
                    "raw_category": sm.group("cat").strip(),
                    "statement_period": to_amount(sm.group("period")),
                    "ytd": to_amount(sm.group("ytd")),
                })
            continue

        # in_details section
        if NET_RE.match(line) or STATEMENT_NET_RE.match(line) or BALANCE_RE.match(line):
            continue

        # Property/unit header line, e.g. "738 S Washington St, Kokomo, IN
        # 46901( Reserve: $0.00 )" — checked before the money-token split
        # below because the "(Reserve: $0.00)" annotation itself contains a
        # dollar amount and would otherwise look like a transaction row.
        hm = PROPERTY_HEADER_RE.match(line)
        if hm:
            current_property = hm.group("addr").strip()
            continue

        moneys = MONEY_TOKEN_RE.findall(line)
        dates = DATE_TOKEN_RE.findall(line)

        if not moneys:
            # A no-$ line inside the details section is either an
            # entity-name label line, resetting to entity-level items (not
            # tied to one property) — e.g. "BLT Partners LLC" — or a stray
            # annotation/continuation fragment from a row that wrapped
            # across a page break (e.g. "Move-in date: 05/09/2025", or the
            # tail end of a description PDF text extraction split mid-row).
            # Only the former should reset current_property; a fragment
            # should just be ignored so it doesn't wipe out a property block
            # that's still in progress.
            if ENTITY_BANNER_RE.match(line):
                current_property = None
            continue

        desc = line
        for tok in moneys:
            desc = desc.replace(tok, " ")
        for tok in dates:
            desc = desc.replace(tok, " ")
        desc = re.sub(r"\s+", " ", desc).strip()
        raw_cat, rest = split_category(desc)

        inc = to_amount(moneys[0]) if len(moneys) > 0 else None
        dec = to_amount(moneys[1]) if len(moneys) > 1 else None
        amount = (inc or 0) - (dec or 0)
        line_items.append({
            "property_label": current_property,
            "raw_category": raw_cat,
            "description": rest,
            "date": to_iso_date(dates[0]) if dates else None,
            "amount": round(amount, 2),
        })

    return summary, category_totals, line_items, period_start, period_end, statement_date


def parse_pdf(path):
    import pdfplumber

    lines = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend(text.split("\n"))

    results = []
    for entity_name, seg_lines in split_pdf_into_entity_segments(lines):
        summary, category_totals, line_items, ps, pe, sd = parse_pdf_segment(seg_lines)
        if not category_totals and not line_items:
            continue  # a segment that only matched noise (e.g. a stray banner)
        results.append((entity_name, summary, category_totals, line_items, ps, pe, sd))
    return results


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--pm", required=True)
    ap.add_argument("--entity", help="Entity name override. For a single-entity file this is required unless the PDF has a detectable banner; for a multi-entity packet, leave unset and let the packet tell you.")
    ap.add_argument("--out-dir", required=True, help="Directory to write one JSON file per statement into.")
    ap.add_argument("--period-start")
    ap.add_argument("--period-end")
    ap.add_argument("--statement-date")
    args = ap.parse_args()

    path = Path(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    statements = []  # (entity_label, summary, category_totals, line_items, period_start, period_end, statement_date)

    if path.suffix.lower() == ".xlsx":
        summary, category_totals, line_items, entity_hint = parse_xlsx(path)
        ps = pe = None
        dates = [li["date"] for li in line_items if li["date"]]
        if dates:
            ps, pe = min(dates), max(dates)
        entity_label = args.entity or entity_hint
        if not entity_label:
            print("No --entity given and none could be inferred from the xlsx.", file=sys.stderr)
            sys.exit(1)
        statements.append((entity_label, summary, category_totals, line_items,
                            args.period_start or ps, args.period_end or pe, args.statement_date))
    elif path.suffix.lower() == ".pdf":
        for entity_name, summary, category_totals, line_items, ps, pe, sd in parse_pdf(path):
            entity_label = args.entity or entity_name
            if not entity_label:
                print(f"Skipping a PDF segment with no detectable entity name ({len(line_items)} line items) — pass --entity to force it.", file=sys.stderr)
                continue
            statements.append((entity_label, summary, category_totals, line_items,
                                args.period_start or ps, args.period_end or pe, args.statement_date or sd))
        if not statements:
            print("No statement segments found in PDF.", file=sys.stderr)
            sys.exit(1)
    else:
        print(f"Unsupported file type: {path.suffix}", file=sys.stderr)
        sys.exit(1)

    for entity_label, summary, category_totals, line_items, period_start, period_end, statement_date in statements:
        out = {
            "source_file": path.name,
            "pm_name": args.pm,
            "entity_label": entity_label,
            "period_start": period_start,
            "period_end": period_end,
            "statement_date": statement_date,
            "summary": summary,
            "category_totals": category_totals,
            "line_items": line_items,
        }
        fname = f"{slugify(entity_label)}_{(period_end or 'unknown').replace('-', '')}.json"
        out_path = out_dir / fname
        out_path.write_text(json.dumps(out, indent=2))
        print(f"Wrote {out_path} — entity={entity_label!r} period={period_start}..{period_end} — {len(line_items)} line items, {len(category_totals)} category totals.")


if __name__ == "__main__":
    main()
