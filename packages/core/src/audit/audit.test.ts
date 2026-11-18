import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABELS,
  auditQuerySchema,
  describeAuditChanges,
} from "./audit";

describe("audit vocabulary (FR-18)", () => {
  it("FR-18: covers every audited kind of record listed in the spec", () => {
    expect(AUDIT_ENTITIES).toEqual(
      expect.arrayContaining([
        "sale",
        "refund",
        "expense",
        "cash_withdrawal",
        "day",
        "month",
        "sale_category",
        "expense_category",
        "payment_method",
        "card_machine",
        "card_fee",
        "setting",
        "backup",
      ]),
    );
  });

  it("FR-18: covers create, edit, delete, close, reopen and restore", () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining(["create", "update", "delete", "close", "reopen", "restore"]),
    );
  });

  it("has a pt-BR label for every entity and action", () => {
    for (const entity of AUDIT_ENTITIES) expect(AUDIT_ENTITY_LABELS[entity]).toBeTruthy();
    for (const action of AUDIT_ACTIONS) expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    expect(AUDIT_ENTITY_LABELS.sale).toBe("Venda");
    expect(AUDIT_ACTION_LABELS.update).toBe("Edição");
  });
});

describe("describeAuditChanges (FR-18: before and after values)", () => {
  it("FR-18: a sale edited from R$ 50,00 to R$ 5,00 shows both values", () => {
    const changes = describeAuditChanges(
      { grossCents: 5000, note: "Cópias" },
      { grossCents: 500, note: "Cópias" },
    );
    expect(changes).toEqual([
      { field: "grossCents", label: "Valor bruto", before: "R$ 50,00", after: "R$ 5,00" },
    ]);
  });

  it("FR-18: a creation lists every field with no previous value", () => {
    expect(describeAuditChanges(null, { name: "Papelaria", active: true })).toEqual([
      { field: "name", label: "Nome", before: null, after: "Papelaria" },
      { field: "active", label: "Ativa", before: null, after: "Sim" },
    ]);
  });

  it("FR-18: a deletion lists every field with no new value", () => {
    expect(describeAuditChanges({ amountCents: -8000 }, null)).toEqual([
      { field: "amountCents", label: "Valor", before: "-R$ 80,00", after: null },
    ]);
  });

  it("formats civil dates as dd/mm/aaaa and keeps unknown fields by their key", () => {
    expect(describeAuditChanges({ date: "2026-11-18" }, { date: "2026-11-19", xyz: 3 })).toEqual([
      { field: "date", label: "Data", before: "18/11/2026", after: "19/11/2026" },
      { field: "xyz", label: "xyz", before: null, after: "3" },
    ]);
  });

  it("returns nothing when there are no values", () => {
    expect(describeAuditChanges(null, null)).toEqual([]);
  });
});

describe("auditQuerySchema (FR-18: filter by date or type)", () => {
  it("FR-18: accepts a date range and an entity type", () => {
    expect(
      auditQuerySchema.parse({ from: "2026-11-01", to: "2026-11-18", entity: "sale" }),
    ).toEqual({ from: "2026-11-01", to: "2026-11-18", entity: "sale", limit: 200 });
  });

  it("parses limit and beforeId from query strings", () => {
    expect(auditQuerySchema.parse({ limit: "50", beforeId: "10" })).toEqual({
      limit: 50,
      beforeId: 10,
    });
  });

  it("FR-18: rejects an invalid date in pt-BR", () => {
    const result = auditQuerySchema.safeParse({ from: "2026-02-30" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Data inicial inválida.");
  });

  it("FR-18: rejects a start date after the end date in pt-BR", () => {
    const result = auditQuerySchema.safeParse({ from: "2026-11-19", to: "2026-11-18" });
    expect(result.error?.issues[0]?.message).toBe(
      "A data inicial deve ser anterior ou igual à data final.",
    );
  });

  it("rejects an unknown entity type and a limit above 500", () => {
    expect(auditQuerySchema.safeParse({ entity: "foo" }).error?.issues[0]?.message).toBe(
      "Tipo de registro desconhecido.",
    );
    expect(auditQuerySchema.safeParse({ limit: "501" }).success).toBe(false);
  });
});
