import { describe, expect, it } from "vitest";

import {
  createUsagePriceTableCatalog,
  createUsageAccounting,
  verifyUsagePriceTableCatalog,
  totalRawTokens,
  usageBudgetTokens,
} from "../src/token-accounting.js";

const usage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 80,
  cacheWriteTokens: 10,
  costUsd: 0.25,
};

describe("model-aware token accounting", () => {
  it("preserves raw totals and discounts cache reads by provider policy", () => {
    const accounting = createUsageAccounting(
      { provider: "openai", id: "gpt-4.1" },
      usage,
    );

    expect(accounting).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        model: "openai/gpt-4.1",
        strategy: "openai_cache_discounted",
        costStrategy: "provider_reported_cost",
        reportedCostUsd: 0.25,
        estimatedCostUsd: 0.000525,
        budgetCostUsd: 0.25,
        priceTableId: "openai-compatible-default.v1",
        priceTableSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        rawTotalTokens: 210,
        budgetTokens: 150,
        cacheReadWeight: 0.25,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(totalRawTokens(usage)).toBe(210);
    expect(usageBudgetTokens(usage, accounting)).toBe(150);
  });

  it("falls back to raw total tokens without valid accounting evidence", () => {
    expect(usageBudgetTokens(usage)).toBe(210);
    expect(
      createUsageAccounting({ provider: "napier", id: "demo" }, usage),
    ).toEqual(
      expect.objectContaining({
        strategy: "demo_estimate",
        costStrategy: "zero_cost",
        rawTotalTokens: 210,
        budgetTokens: 210,
        estimatedCostUsd: 0,
        budgetCostUsd: 0,
      }),
    );
  });

  it("uses explicit price tables when providers report zero cost", () => {
    const accounting = createUsageAccounting(
      { provider: "anthropic", id: "claude-3.5-sonnet" },
      {
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 2_000,
        cacheWriteTokens: 100,
        costUsd: 0,
      },
    );

    expect(accounting).toEqual(
      expect.objectContaining({
        costStrategy: "price_table_estimate",
        priceTableId: "anthropic-default.v1",
        reportedCostUsd: 0,
        estimatedCostUsd: 0.011475,
        budgetCostUsd: 0.011475,
        priceTableSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("exports and verifies hash-bound provider price table catalogs", () => {
    const catalog = createUsagePriceTableCatalog({
      generatedAt: new Date("2026-07-26T00:00:00.000Z"),
    });

    expect(catalog).toEqual(
      expect.objectContaining({
        kind: "napier.usage-price-table-catalog",
        schemaVersion: 1,
        generatedAt: "2026-07-26T00:00:00.000Z",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(catalog.tables.map((table) => table.provider)).toEqual([
      "anthropic",
      "google",
      "napier",
      "openai",
      "openrouter",
    ]);
    expect(
      catalog.tables.every((table) => /^[a-f0-9]{64}$/.test(table.tableSha256)),
    ).toBe(true);
    expect(
      verifyUsagePriceTableCatalog(catalog, {
        requiredProviders: ["openai", "anthropic"],
      }),
    ).toEqual(
      expect.objectContaining({
        status: "valid",
        tableCount: 5,
        providers: ["anthropic", "google", "napier", "openai", "openrouter"],
        catalogSha256: catalog.contentSha256,
        diagnostics: [],
      }),
    );
  });

  it("rejects tampered price catalogs and reports missing providers", () => {
    const catalog = createUsagePriceTableCatalog({
      generatedAt: new Date("2026-07-26T00:00:00.000Z"),
    });
    const missing = createUsagePriceTableCatalog({
      tables: catalog.tables
        .filter((table) => table.provider !== "google")
        .map(
          ({ schemaVersion: _schemaVersion, tableSha256: _hash, ...table }) =>
            table,
        ),
      generatedAt: new Date("2026-07-26T00:00:00.000Z"),
    });
    expect(
      verifyUsagePriceTableCatalog(missing, {
        requiredProviders: ["google"],
      }),
    ).toEqual(
      expect.objectContaining({
        status: "provider_missing",
        diagnostics: ["provider_missing:google"],
      }),
    );

    const tampered = structuredClone(catalog);
    tampered.tables[0]!.inputUsdPerMillion += 1;
    expect(verifyUsagePriceTableCatalog(tampered)).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          expect.stringContaining("table_hash_mismatch"),
          "catalog_hash_mismatch",
        ]),
      }),
    );
  });

  it("can preview accounting with a refreshed provider price table", () => {
    const catalog = createUsagePriceTableCatalog({
      tables: [
        {
          id: "openai-refresh-2026-07-26",
          provider: "openai",
          label: "OpenAI refreshed table",
          inputUsdPerMillion: 10,
          outputUsdPerMillion: 40,
          cacheReadUsdPerMillion: 2.5,
          cacheWriteUsdPerMillion: 10,
          effectiveAt: "2026-07-26T00:00:00.000Z",
          source: "operator_refresh",
        },
      ],
      generatedAt: new Date("2026-07-26T00:00:00.000Z"),
    });

    const accounting = createUsageAccounting(
      { provider: "openai", id: "gpt-4.1" },
      { ...usage, costUsd: 0 },
      { priceTables: catalog.tables },
    );

    expect(accounting).toEqual(
      expect.objectContaining({
        costStrategy: "price_table_estimate",
        priceTableId: "openai-refresh-2026-07-26",
        estimatedCostUsd: 0.0021,
        budgetCostUsd: 0.0021,
        priceTableSha256: catalog.tables[0]!.tableSha256,
      }),
    );
  });
});
