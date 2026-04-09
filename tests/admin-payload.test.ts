import { describe, expect, it } from "vitest";
import { toAccessRuleSummary, type AuthRuleRecord } from "../worker/src/db";

describe("admin payload sanitization", () => {
  it("strips password internals from access rule summaries", () => {
    const record: AuthRuleRecord = {
      id: "rule-1",
      label: "Админ-доступ",
      passwordHash: "secret-hash",
      passwordSalt: "secret-salt",
      hashScheme: "sha256_v1",
      targetMode: "admin_mode",
      isEnabled: true,
      priority: 100,
      notes: "note",
      usageCount: 4,
      successCount: 3,
      failCount: 1,
      lastUsedAt: "2026-04-09 14:10:00",
      createdAt: "2026-04-09 14:00:00",
      updatedAt: "2026-04-09 14:10:00",
      expiresAt: null,
      maxUses: null,
      firstUseOnly: false,
      softDeletedAt: null
    };

    const summary = toAccessRuleSummary(record);
    expect(summary).toEqual({
      id: "rule-1",
      label: "Админ-доступ",
      targetMode: "admin_mode",
      isEnabled: true,
      priority: 100,
      notes: "note",
      usageCount: 4,
      successCount: 3,
      failCount: 1,
      lastUsedAt: "2026-04-09 14:10:00",
      createdAt: "2026-04-09 14:00:00",
      updatedAt: "2026-04-09 14:10:00",
      expiresAt: null,
      maxUses: null,
      firstUseOnly: false,
      softDeletedAt: null
    });
    expect(summary).not.toHaveProperty("passwordHash");
    expect(summary).not.toHaveProperty("passwordSalt");
    expect(summary).not.toHaveProperty("hashScheme");
  });
});
