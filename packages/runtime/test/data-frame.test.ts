import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DATA_FRAME_LIMITS_SHA256,
  executeDataFrame,
  MAX_DATA_FRAME_OUTPUT_BYTES,
} from "../src/data-frame.js";
import { sha256 } from "../src/ed25519.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("hash-bound DataFrame execution", () => {
  it("transforms a real CSV into complete deterministic table JSON", async () => {
    const fixture = await createCsvFixture();
    const source = [
      "region,status,amount",
      "east,paid,10",
      "east,paid,5",
      "west,paid,30",
      "west,pending,100",
      "",
    ].join("\n");
    const request = {
      action: "transform" as const,
      path: "orders.csv",
      sourceSha256: sha256(source),
      operations: [
        {
          type: "cast" as const,
          column: "amount",
          dataType: "number" as const,
        },
        {
          type: "filter" as const,
          column: "status",
          operator: "eq" as const,
          value: "paid",
        },
        {
          type: "group" as const,
          by: ["region"],
          aggregations: [
            { operation: "sum" as const, column: "amount", as: "Total" },
            { operation: "count" as const, as: "Orders" },
          ],
        },
        {
          type: "sort" as const,
          columns: [{ column: "Total", direction: "desc" as const }],
        },
      ],
    };
    const first = await executeDataFrame(fixture, request);
    const second = await executeDataFrame(fixture, request);

    expect(first).toEqual(second);
    expect(first).toEqual(
      expect.objectContaining({
        kind: "napier.data-frame-result",
        schemaVersion: 1,
        action: "transform",
        source: expect.objectContaining({
          path: "orders.csv",
          fileSha256: sha256(source),
          format: "csv",
          rowCount: 4,
          columnCount: 3,
        }),
        operationCount: 4,
        columns: ["region", "Total", "Orders"],
        rows: [
          ["west", 30, 1],
          ["east", 15, 2],
        ],
        rowCount: 2,
        columnCount: 3,
        limitsSha256: DATA_FRAME_LIMITS_SHA256,
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.parse(first.output)).toEqual({
      columns: ["region", "Total", "Orders"],
      rows: [
        ["west", 30, 1],
        ["east", 15, 2],
      ],
      rowCount: 2,
    });
    expect(first.outputBytes).toBeLessThan(MAX_DATA_FRAME_OUTPUT_BYTES);
    expect(first.outputSha256).toBe(sha256(first.output));
  });

  it("preserves JSON scalar types without implicit coercion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-data-frame-json-"));
    roots.push(root);
    const source = JSON.stringify([
      { team: "red", score: 10, active: true },
      { team: "blue", score: 7, active: false },
      { team: "red", score: 5, active: true },
    ]);
    await writeFile(path.join(root, "scores.json"), source);

    const result = await executeDataFrame(root, {
      action: "transform",
      path: "scores.json",
      sourceSha256: sha256(source),
      operations: [
        {
          type: "filter",
          column: "active",
          operator: "eq",
          value: true,
        },
        {
          type: "group",
          by: ["team"],
          aggregations: [{ operation: "mean", column: "score", as: "Average" }],
        },
      ],
    });

    expect(result.rows).toEqual([["red", 7.5]]);
  });

  it("rejects stale, protected, symlinked, nested, cancelled, and oversized output", async () => {
    const fixture = await createCsvFixture();
    await expect(
      executeDataFrame(fixture, {
        action: "transform",
        path: "orders.csv",
        sourceSha256: "f".repeat(64),
        operations: [{ type: "limit", count: 1 }],
      }),
    ).rejects.toThrow("does not match sourceSha256");
    await expect(
      executeDataFrame(fixture, {
        action: "transform",
        path: "PRIVATE_MISSING_SOURCE.csv",
        sourceSha256: "a".repeat(64),
        operations: [{ type: "limit", count: 1 }],
      }).catch((error: unknown) => {
        expect(String(error)).not.toContain("PRIVATE_MISSING_SOURCE");
        throw error;
      }),
    ).rejects.toThrow("source is unavailable");

    const nested = JSON.stringify([{ value: { secret: true } }]);
    await writeFile(path.join(fixture, "nested.json"), nested);
    await expect(
      executeDataFrame(fixture, {
        action: "transform",
        path: "nested.json",
        sourceSha256: sha256(nested),
        operations: [{ type: "limit", count: 1 }],
      }),
    ).rejects.toThrow("bounded scalar");

    if (process.platform !== "win32") {
      await symlink("orders.csv", path.join(fixture, "orders-link.csv"));
      await expect(
        executeDataFrame(fixture, {
          action: "transform",
          path: "orders-link.csv",
          sourceSha256: sha256(
            await readFile(path.join(fixture, "orders.csv")),
          ),
          operations: [{ type: "limit", count: 1 }],
        }),
      ).rejects.toThrow("symbolic link");
    }
    await expect(
      executeDataFrame(fixture, {
        action: "transform",
        path: ".git/private.csv",
        sourceSha256: "a".repeat(64),
        operations: [{ type: "limit", count: 1 }],
      }),
    ).rejects.toThrow("protected path");

    const controller = new AbortController();
    controller.abort();
    await expect(
      executeDataFrame(
        fixture,
        {
          action: "transform",
          path: "orders.csv",
          sourceSha256: "a".repeat(64),
          operations: [{ type: "limit", count: 1 }],
        },
        controller.signal,
      ),
    ).rejects.toThrow(/abort/iu);

    const largeRows = Array.from({ length: 1_000 }, (_value, index) => ({
      id: index,
      value: "x".repeat(300),
    }));
    const large = JSON.stringify(largeRows);
    await writeFile(path.join(fixture, "large.json"), large);
    await expect(
      executeDataFrame(fixture, {
        action: "transform",
        path: "large.json",
        sourceSha256: sha256(large),
        operations: [{ type: "limit", count: 1_000 }],
      }),
    ).rejects.toThrow("output exceeds 256 KiB");
  });
});

async function createCsvFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-data-frame-"));
  roots.push(root);
  await writeFile(
    path.join(root, "orders.csv"),
    [
      "region,status,amount",
      "east,paid,10",
      "east,paid,5",
      "west,paid,30",
      "west,pending,100",
      "",
    ].join("\n"),
  );
  return root;
}
