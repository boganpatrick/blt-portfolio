// Regression tests for src/lib/metrics.ts's pure calculation functions.
//
// These exist because of two real production bugs, both caught by Patrick
// after they'd already shipped:
//   1. 615 Cherry St's loan had `originalAmount` set but `currentBalance`
//      left null, which the dashboard's equity calc silently read as a
//      $0-debt cash purchase (full equity shown, no loan). (2026-09-21)
//   2. 615 Cherry St's interest-only 9-month hard money loan was run
//      through the standard amortization formula, producing a ~$21k/mo
//      "PITI" instead of the real ~$1,641/mo interest-only payment.
//      (2026-09-21)
//
// Every test below that reproduces one of these bugs is written to FAIL if
// the underlying fix is ever reverted — that's the point of a regression
// test. Run with `npm test`.

import { describe, it, expect } from "vitest";
import {
  monthlyPrincipalAndInterest,
  computePropertyMetrics,
  computeMetricWarnings,
  resolveCurrentRent,
} from "../metrics";
import type { loans, properties } from "@/db/schema";

// ---------- Fixtures ----------
// Minimal fake rows — only the fields the functions under test actually
// read. Cast through `unknown` since these are intentionally partial.
function makeLoan(overrides: Partial<typeof loans.$inferSelect> = {}): typeof loans.$inferSelect {
  return {
    id: "loan-1",
    propertyId: "prop-1",
    lender: "Test Lender",
    loanType: "conventional",
    originalAmount: null,
    originationDate: null,
    rate: null,
    termMonths: null,
    interestOnly: false,
    prepayPenaltyTerms: null,
    currentBalance: null,
    balanceAsOf: null,
    monthlyTaxEscrow: null,
    monthlyInsuranceEscrow: null,
    notes: null,
    ...overrides,
  } as unknown as typeof loans.$inferSelect;
}

function makeProperty(overrides: Partial<typeof properties.$inferSelect> = {}): typeof properties.$inferSelect {
  return {
    id: "prop-1",
    address: "123 Test St",
    city: "Testville",
    state: "IN",
    zip: null,
    propertyType: "SFH",
    status: "leased",
    purchasePrice: 100000,
    purchaseDate: "2025-01-01",
    targetCloseDate: null,
    rehabBudget: null,
    rehabSpentToDate: null,
    rehabCompleteDate: null,
    putIntoServiceDate: null,
    currentEstValue: 150000,
    currentValueSource: null,
    currentValueAsOf: null,
    notes: null,
    ...overrides,
  } as unknown as typeof properties.$inferSelect;
}

describe("monthlyPrincipalAndInterest", () => {
  it("returns $0/known when there's no loan (cash purchase)", () => {
    expect(monthlyPrincipalAndInterest(undefined)).toEqual({ value: 0, known: true });
  });

  it("returns $0/known when currentBalance is null (cash purchase, or a data gap for a closed loan)", () => {
    const loan = makeLoan({ originalAmount: 180646, rate: 0.109, termMonths: 9 });
    expect(monthlyPrincipalAndInterest(loan)).toEqual({ value: 0, known: true });
  });

  it("returns known:false when there's a balance but no rate", () => {
    const loan = makeLoan({ currentBalance: 100000, originalAmount: 100000, termMonths: 360 });
    expect(monthlyPrincipalAndInterest(loan).known).toBe(false);
  });

  it("computes standard amortizing P&I correctly for a normal 30yr loan (regression: 5109 Mohawk's real numbers)", () => {
    // Real production data: $105,000 @ 6.75%/30yr should be ~$681/mo P&I.
    const loan = makeLoan({ currentBalance: 103977, originalAmount: 105000, rate: 0.0675, termMonths: 360 });
    const { value, known } = monthlyPrincipalAndInterest(loan);
    expect(known).toBe(true);
    expect(value).toBeGreaterThan(670);
    expect(value).toBeLessThan(690);
  });

  it("REGRESSION: does NOT amortize an interest-only loan over its short term (the 615 Cherry St $20k/mo bug)", () => {
    // Real production data: Nation Loan Funding LLC hard money loan,
    // $180,646 @ 10.90%, 9-month term, interest-only. The known-correct
    // monthly interest payment (per the signed term sheet) is $1,640.87.
    // Before the interestOnly flag existed, this loan was run through the
    // standard amortization formula with n=9 months, producing ~$21,000/mo
    // — an amount that would pay off the entire loan in under a year.
    const loan = makeLoan({
      currentBalance: 144415,
      originalAmount: 180646,
      rate: 0.109,
      termMonths: 9,
      interestOnly: true,
    });
    const { value, known } = monthlyPrincipalAndInterest(loan);
    expect(known).toBe(true);
    expect(value).toBeCloseTo(1640.87, 0);
    // The specific failure mode: a "payment" this large would retire the
    // loan in under a year. Assert directly against that, so this test
    // fails loudly if interestOnly handling is ever removed/broken again.
    expect(value * 12).toBeLessThan(loan.originalAmount!);
  });

  it("an interest-only loan with no term_months still computes correctly (term is irrelevant for interest-only)", () => {
    const loan = makeLoan({ currentBalance: 50000, originalAmount: 50000, rate: 0.12, termMonths: null, interestOnly: true });
    const { value, known } = monthlyPrincipalAndInterest(loan);
    expect(known).toBe(true);
    expect(value).toBeCloseTo(500, 0); // 50000 * 0.12 / 12
  });
});

describe("computeMetricWarnings", () => {
  it("REGRESSION: flags a closed loan (has originalAmount) with no currentBalance (the 615 Cherry St full-equity bug)", () => {
    const property = makeProperty();
    const loan = makeLoan({ originalAmount: 180646, currentBalance: null });
    const metrics = computePropertyMetrics({ property, loan, noi: undefined });
    const warnings = computeMetricWarnings({ property, loan, metrics });
    expect(warnings.some((w) => w.field === "debt")).toBe(true);
  });

  it("does not flag a genuine cash purchase (no loan at all)", () => {
    const property = makeProperty();
    const metrics = computePropertyMetrics({ property, loan: undefined, noi: undefined });
    const warnings = computeMetricWarnings({ property, loan: undefined, metrics });
    expect(warnings.some((w) => w.field === "debt")).toBe(false);
  });

  it("REGRESSION: flags a monthly P&I that would retire the loan in under a year (catches the amortization-of-a-short-term bug even without knowing about interestOnly)", () => {
    const property = makeProperty();
    // Same numbers as the real bug, but with interestOnly forgotten again —
    // this is the safety net for the exact class of mistake that caused it.
    const loan = makeLoan({ currentBalance: 144415, originalAmount: 180646, rate: 0.109, termMonths: 9, interestOnly: false });
    const metrics = computePropertyMetrics({ property, loan, noi: undefined });
    const warnings = computeMetricWarnings({ property, loan, metrics });
    expect(warnings.some((w) => w.field === "piti")).toBe(true);
  });

  it("does not flag a normal, healthy 30yr loan", () => {
    const property = makeProperty({ currentEstValue: 150000, purchasePrice: 100000 });
    const loan = makeLoan({ currentBalance: 103977, originalAmount: 105000, rate: 0.0675, termMonths: 360 });
    const metrics = computePropertyMetrics({
      property,
      loan,
      noi: { monthlyAvg: 800, months: 6, opexMonthlyAvg: 400 },
    });
    const warnings = computeMetricWarnings({ property, loan, metrics });
    expect(warnings).toEqual([]);
  });

  it("flags a current value more than 5x purchase price as a likely typo", () => {
    const property = makeProperty({ purchasePrice: 100000, currentEstValue: 600000 });
    const metrics = computePropertyMetrics({ property, loan: undefined, noi: undefined });
    const warnings = computeMetricWarnings({ property, loan: undefined, metrics });
    expect(warnings.some((w) => w.field === "value")).toBe(true);
  });

  it("flags an implausibly high DSCR", () => {
    const property = makeProperty();
    const loan = makeLoan({ currentBalance: 10000, originalAmount: 10000, rate: 0.05, termMonths: 360 });
    const metrics = computePropertyMetrics({
      property,
      loan,
      noi: { monthlyAvg: 50000, months: 3, opexMonthlyAvg: 0 }, // absurdly high NOI relative to a tiny loan
    });
    const warnings = computeMetricWarnings({ property, loan, metrics });
    expect(warnings.some((w) => w.field === "dscr")).toBe(true);
  });
});

describe("computePropertyMetrics", () => {
  it("equity/leverage-relevant debt service is null (not $0) when a loan has a balance but unknown rate", () => {
    const property = makeProperty();
    const loan = makeLoan({ currentBalance: 100000 }); // no rate at all
    const metrics = computePropertyMetrics({ property, loan, noi: undefined });
    expect(metrics.annualDebtService).toBeNull();
    expect(metrics.dscr).toBeNull();
  });

  it("cap rate falls back to VARE ARV only when NOI itself is projected", () => {
    const property = makeProperty({ currentEstValue: null });
    const metrics = computePropertyMetrics({
      property,
      loan: undefined,
      noi: undefined,
      underwriting: {
        id: "uw-1", propertyId: "prop-1", sourceFile: null, purchasePrice: null,
        rehabCostBudget: null, arv: 260000, projectedMonthlyRent: 1800,
        vacancyPct: 0.04, repairPct: 0.04, capexPct: 0.04, pmFeePct: 0.09,
        projectedYear1CashFlow: null, projectedYear1TotalReturn: null, notes: null,
      } as never,
    });
    expect(metrics.noiIsProjected).toBe(true);
    expect(metrics.capRateValueIsArv).toBe(true);
    expect(metrics.capRate).not.toBeNull();
  });

  it("leverage is null when there's no current value on file (can't compute LTV against nothing)", () => {
    const property = makeProperty({ currentEstValue: null });
    const loan = makeLoan({ currentBalance: 50000 });
    const metrics = computePropertyMetrics({ property, loan, noi: undefined });
    expect(metrics.leveragePct).toBeNull();
  });
});

describe("resolveCurrentRent", () => {
  it("prefers the PM statement rent when it doesn't look prorated", () => {
    const result = resolveCurrentRent({
      pmRent: { amount: 1500, asOf: "2026-06-30" },
      leaseRent: 1400,
      mostRecentLeaseStart: "2025-01-01",
      estimateRent: 1600,
    });
    expect(result).toEqual({ amount: 1500, source: "pm" });
  });

  it("REGRESSION: falls back to the lease rent when the PM statement period matches the lease's start month (prorated first month)", () => {
    // Real production case: 1339 Division St's tenant moved in 2026-07-22,
    // so July's PM-reported rent was $591.78 (prorated) against the real
    // $1,800/mo lease.
    const result = resolveCurrentRent({
      pmRent: { amount: 591.78, asOf: "2026-07-31" },
      leaseRent: 1800,
      mostRecentLeaseStart: "2026-07-22",
      estimateRent: null,
    });
    expect(result).toEqual({ amount: 1800, source: "lease" });
  });

  it("falls back to VARE estimate when there's no PM or lease rent at all", () => {
    const result = resolveCurrentRent({ pmRent: undefined, leaseRent: null, mostRecentLeaseStart: null, estimateRent: 1800 });
    expect(result).toEqual({ amount: 1800, source: "estimate" });
  });

  it("returns null/null when there's no rent source of any kind", () => {
    const result = resolveCurrentRent({ pmRent: undefined, leaseRent: null, mostRecentLeaseStart: null, estimateRent: null });
    expect(result).toEqual({ amount: null, source: null });
  });
});
