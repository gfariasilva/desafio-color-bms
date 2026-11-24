import { describe, expect, it } from "vitest";
import type { SaleCategory } from "../catalog/categories";
import {
  buildTabRanking,
  formatShare,
  rankingPeriods,
  shareTenths,
  tabRankingQuerySchema,
  tabRankingSchema,
} from "./tab-ranking";

describe("rankingPeriods (FR-25)", () => {
  it("FR-25: the current month runs from day 1 to today, against the same days (A-13)", () => {
    expect(rankingPeriods("2026-11", "2026-11-18")).toEqual({
      yearMonth: "2026-11",
      previousMonth: "2026-10",
      partial: true,
      current: { from: "2026-11-01", to: "2026-11-18" },
      previous: { from: "2026-10-01", to: "2026-10-18" },
    });
  });

  it("FR-25: a past month is compared whole with the whole previous month", () => {
    expect(rankingPeriods("2026-09", "2026-11-18")).toEqual({
      yearMonth: "2026-09",
      previousMonth: "2026-08",
      partial: false,
      current: { from: "2026-09-01", to: "2026-09-30" },
      // 31/08 counts: the whole of August, not "the same 30 days".
      previous: { from: "2026-08-01", to: "2026-08-31" },
    });
    expect(rankingPeriods("2027-03", "2027-05-02").previous).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
  });

  it("FR-25: in January the previous month is December of the year before", () => {
    expect(rankingPeriods("2027-01", "2027-01-15")).toMatchObject({
      previousMonth: "2026-12",
      previous: { from: "2026-12-01", to: "2026-12-15" },
    });
  });

  it("FR-25: a shorter previous month stops at its last day (31/03 → 01–28/02)", () => {
    expect(rankingPeriods("2027-03", "2027-03-31").previous).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
  });

  it("FR-25: rejects a month after today's and invalid input", () => {
    expect(() => rankingPeriods("2026-12", "2026-11-18")).toThrow(RangeError);
    expect(() => rankingPeriods("2026-13", "2026-11-18")).toThrow(RangeError);
    expect(() => rankingPeriods("2026-11", "18/11/2026")).toThrow(RangeError);
  });
});

describe("tabRankingQuerySchema (FR-25)", () => {
  it("FR-25: the month is YYYY-MM, with a pt-BR message", () => {
    expect(tabRankingQuerySchema.parse({ month: "2026-11" })).toEqual({ month: "2026-11" });
    const parsed = tabRankingQuerySchema.safeParse({ month: "11/2026" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Mês inválido.");
  });
});

describe("shareTenths (FR-25)", () => {
  it("FR-25: the share of the total in tenths of a percent", () => {
    expect(shareTenths(2500, 10000)).toBe(250); // 25,0 %
    expect(shareTenths(10000, 10000)).toBe(1000);
    expect(shareTenths(0, 10000)).toBe(0);
    expect(shareTenths(1, 3)).toBe(333); // 33,33… %
    expect(shareTenths(2, 3)).toBe(667); // 66,66… %
  });

  it("FR-25: rounds half away from zero, also for a negative tab (refunds)", () => {
    expect(shareTenths(1, 2000)).toBe(1); // 0,05 % → 0,1 %
    expect(shareTenths(-1, 2000)).toBe(-1); // −0,05 % → −0,1 %
    expect(shareTenths(-500, 10000)).toBe(-50);
  });

  it('FR-25: no share when the total is zero or negative ("—")', () => {
    expect(shareTenths(0, 0)).toBeNull();
    expect(shareTenths(500, 0)).toBeNull();
    expect(shareTenths(-500, -500)).toBeNull();
  });

  it("FR-25: rejects amounts that are not integer cents", () => {
    expect(() => shareTenths(1.5, 100)).toThrow(RangeError);
  });
});

describe("formatShare (FR-25)", () => {
  it('FR-25: formats "56,0%", "100,0%", "−5,0%" and "—"', () => {
    expect(formatShare(560)).toBe("56,0%");
    expect(formatShare(1000)).toBe("100,0%");
    expect(formatShare(0)).toBe("0,0%");
    expect(formatShare(-50)).toBe("−5,0%");
    expect(formatShare(null)).toBe("—");
  });
});

/** The RN-12 tabs, in display order (ids 1…9). */
const TAB_NAMES = [
  "Acessórios",
  "Carimbos",
  "Cartuchos compatíveis",
  "Recargas",
  "Papelaria",
  "Chaveiro",
  "Toner",
  "Serviços de copiadora",
  "Personalizados",
];
const tabs: SaleCategory[] = TAB_NAMES.map((name, index) => ({
  id: index + 1,
  name,
  order: index + 1,
  active: true,
}));
const id = (name: string) => TAB_NAMES.indexOf(name) + 1;

describe("buildTabRanking (FR-25, RN-11)", () => {
  it("FR-25: tabs in decreasing order of gross income, with % of total and variation", () => {
    const ranking = buildTabRanking({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      current: [
        { saleCategoryId: id("Papelaria"), grossCents: 30000 },
        { saleCategoryId: id("Toner"), grossCents: 50000 },
        { saleCategoryId: id("Chaveiro"), grossCents: 20000 },
      ],
      previous: [
        { saleCategoryId: id("Toner"), grossCents: 40000 },
        { saleCategoryId: id("Papelaria"), grossCents: 60000 },
      ],
    });

    expect(tabRankingSchema.parse(ranking)).toEqual(ranking);
    expect(ranking).toMatchObject({
      yearMonth: "2026-11",
      previousMonth: "2026-10",
      partial: true,
      current: { from: "2026-11-01", to: "2026-11-18" },
      previous: { from: "2026-10-01", to: "2026-10-18" },
      totalCents: 100000,
      previousTotalCents: 100000,
      totalVariationTenths: 0,
    });
    expect(ranking.tabs.slice(0, 3)).toEqual([
      {
        position: 1,
        saleCategoryId: id("Toner"),
        name: "Toner",
        order: 7,
        active: true,
        grossCents: 50000,
        shareTenths: 500,
        previousCents: 40000,
        variationTenths: 250, // +25,0 %
      },
      {
        position: 2,
        saleCategoryId: id("Papelaria"),
        name: "Papelaria",
        order: 5,
        active: true,
        grossCents: 30000,
        shareTenths: 300,
        previousCents: 60000,
        variationTenths: -500, // −50,0 %
      },
      {
        position: 3,
        saleCategoryId: id("Chaveiro"),
        name: "Chaveiro",
        order: 6,
        active: true,
        grossCents: 20000,
        shareTenths: 200,
        previousCents: 0,
        variationTenths: null, // RN-11: "—"
      },
    ]);
  });

  it("FR-25: every active tab is listed; ties (including R$ 0,00) keep the display order", () => {
    const ranking = buildTabRanking({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      current: [
        { saleCategoryId: id("Toner"), grossCents: 1000 },
        { saleCategoryId: id("Carimbos"), grossCents: 1000 },
      ],
      previous: [],
    });
    expect(ranking.tabs.map((t) => t.name)).toEqual([
      "Carimbos",
      "Toner",
      "Acessórios",
      "Cartuchos compatíveis",
      "Recargas",
      "Papelaria",
      "Chaveiro",
      "Serviços de copiadora",
      "Personalizados",
    ]);
    expect(ranking.tabs.map((t) => t.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ranking.tabs[2]).toMatchObject({ grossCents: 0, shareTenths: 0, previousCents: 0 });
    expect(ranking.previousTotalCents).toBe(0);
    expect(ranking.totalVariationTenths).toBeNull();
  });

  it("FR-25: an inactive tab is listed only when it has sales in either period", () => {
    const withInactive: SaleCategory[] = [
      ...tabs,
      { id: 10, name: "Xerox antiga", order: 10, active: false },
      { id: 11, name: "Revelação", order: 11, active: false },
    ];
    const ranking = buildTabRanking({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs: withInactive,
      current: [],
      previous: [{ saleCategoryId: 10, grossCents: 5000 }],
    });
    const names = ranking.tabs.map((t) => t.name);
    expect(names).toContain("Xerox antiga");
    expect(names).not.toContain("Revelação");
    expect(ranking.tabs.find((t) => t.name === "Xerox antiga")).toMatchObject({
      active: false,
      grossCents: 0,
      previousCents: 5000,
      variationTenths: -1000, // −100,0 %
    });
  });

  it("FR-25 (RN-04): a refund lowers its tab, which can end below zero", () => {
    const ranking = buildTabRanking({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      // Toner: only a refund of an October sale (negative gross).
      current: [
        { saleCategoryId: id("Papelaria"), grossCents: 21000 },
        { saleCategoryId: id("Toner"), grossCents: -1000 },
      ],
      previous: [{ saleCategoryId: id("Toner"), grossCents: 8000 }],
    });
    expect(ranking.totalCents).toBe(20000);
    expect(ranking.tabs[0]).toMatchObject({ name: "Papelaria", shareTenths: 1050 });
    const last = ranking.tabs.at(-1);
    expect(last).toMatchObject({
      name: "Toner",
      position: 9,
      grossCents: -1000,
      shareTenths: -50,
      variationTenths: -1125, // −112,5 %
    });
  });

  it('FR-25: a month whose total is zero or negative has no shares ("—")', () => {
    const ranking = buildTabRanking({
      yearMonth: "2026-11",
      today: "2026-11-18",
      tabs,
      current: [{ saleCategoryId: id("Toner"), grossCents: -1000 }],
      previous: [],
    });
    expect(ranking.totalCents).toBe(-1000);
    expect(ranking.tabs.every((t) => t.shareTenths === null)).toBe(true);
  });

  it("FR-25: the total is the sum of the tabs in both periods", () => {
    const ranking = buildTabRanking({
      yearMonth: "2026-10",
      today: "2026-11-18",
      tabs,
      current: [
        { saleCategoryId: 1, grossCents: 111 },
        { saleCategoryId: 2, grossCents: 222 },
        { saleCategoryId: 3, grossCents: 333 },
      ],
      previous: [
        { saleCategoryId: 1, grossCents: 1000 },
        { saleCategoryId: 4, grossCents: 1000 },
      ],
    });
    expect(ranking.partial).toBe(false);
    expect(ranking.totalCents).toBe(ranking.tabs.reduce((sum, t) => sum + t.grossCents, 0));
    expect(ranking.previousTotalCents).toBe(
      ranking.tabs.reduce((sum, t) => sum + t.previousCents, 0),
    );
    expect(ranking.totalVariationTenths).toBe(-667); // 666 vs 2.000 → −66,7 %
  });
});
