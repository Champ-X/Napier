import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import {
  createDataFrameTool,
  dataFrameToolCallArgumentsLedgerProjection,
  dataFrameToolOutputLedgerProjection,
} from "../src/data-frame-tool.js";
import { sha256 } from "../src/ed25519.js";
import { assessToolCall } from "../src/policy.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("data_frame Agent tool", () => {
  it("returns complete table JSON with schema-1 hash-only details", async () => {
    const fixture = await createFixture();
    const tool = createDataFrameTool(fixture.root);
    const args = {
      action: "transform" as const,
      path: "PRIVATE_ORDERS.csv",
      sourceSha256: sha256(fixture.source),
      operations: [
        {
          type: "cast" as const,
          column: "PRIVATE_AMOUNT",
          dataType: "number" as const,
        },
        {
          type: "filter" as const,
          column: "PRIVATE_STATUS",
          operator: "eq" as const,
          value: "PRIVATE_PAID",
        },
        {
          type: "group" as const,
          by: ["PRIVATE_REGION"],
          aggregations: [
            {
              operation: "sum" as const,
              column: "PRIVATE_AMOUNT",
              as: "PRIVATE_TOTAL",
            },
          ],
        },
      ],
    };
    const transformed = await tool.execute("data-frame-call", args);
    const live = transformed.content[0]?.text ?? "";

    expect(live).toContain("DATAFRAME TABLE JSON");
    expect(live).toContain('"PRIVATE_TOTAL"');
    expect(live).toContain('"west"');
    expect(transformed.details).toEqual(
      expect.objectContaining({
        kind: "napier.data-frame",
        schemaVersion: 1,
        action: "transform",
        sourceSha256: sha256(fixture.source),
        sourceFormat: "csv",
        sourceRowCount: 4,
        sourceColumnCount: 3,
        operationCount: 3,
        rowCount: 2,
        columnCount: 2,
        planSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        rowsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        parserSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        engineSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    const call = dataFrameToolCallArgumentsLedgerProjection(args);
    const output = dataFrameToolOutputLedgerProjection(live, {
      details: {
        ...transformed.details,
        PRIVATE_ROWS: ["PRIVATE_VALUE"],
        path: "PRIVATE_ORDERS.csv",
      },
    });
    const durable = JSON.stringify({ call, output });
    for (const secret of [
      "PRIVATE_ORDERS",
      "PRIVATE_AMOUNT",
      "PRIVATE_STATUS",
      "PRIVATE_PAID",
      "PRIVATE_REGION",
      "PRIVATE_TOTAL",
      "PRIVATE_VALUE",
      "west",
      "east",
      "DATAFRAME TABLE JSON",
    ]) {
      expect(durable).not.toContain(secret);
    }
    expect(call).toEqual(
      expect.objectContaining({
        redacted: true,
        operationCount: 3,
        sourceSha256: sha256(fixture.source),
        planSha256: transformed.details.planSha256,
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        details: expect.objectContaining({
          kind: "napier.data-frame",
          operationCount: 3,
          rowCount: 2,
        }),
      }),
    );
    await expect(
      tool
        .execute("invalid-data-frame-call", {
          ...args,
          operations: [
            {
              type: "cast",
              column: "PRIVATE_MISSING_COLUMN",
              dataType: "number",
            },
          ],
        })
        .catch((error: unknown) => {
          expect(String(error)).not.toContain("PRIVATE_MISSING_COLUMN");
          throw error;
        }),
    ).rejects.toThrow("DataFrame column does not exist");
    expect(
      JSON.stringify(
        dataFrameToolCallArgumentsLedgerProjection({
          ...args,
          sourceSha256: "PRIVATE_SOURCE_SHA",
        }),
      ),
    ).not.toContain("PRIVATE_SOURCE_SHA");
    expect(
      dataFrameToolOutputLedgerProjection("PRIVATE_OUTPUT", {
        details: {
          ...transformed.details,
          sourceFormat: "PRIVATE_FORMAT",
        },
      }),
    ).not.toHaveProperty("details");
  });

  it("is a workspace-confined read effect", () => {
    const workspace = path.resolve("/workspace");
    expect(
      assessToolCall(
        "observe",
        "data_frame",
        { path: "data/orders.csv" },
        workspace,
      ),
    ).toEqual(expect.objectContaining({ allowed: true, risk: "low" }));
    expect(
      assessToolCall(
        "workspace",
        "data_frame",
        { path: "../orders.csv" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "path escapes the configured workspace",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "data_frame",
        { path: ".git/orders.csv" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "DataFrame cannot read protected path segment: .git",
      }),
    );
    expect(builtInToolEffect("data_frame")).toBe("read");
  });
});

async function createFixture(): Promise<{ root: string; source: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-data-frame-tool-"));
  roots.push(root);
  const source = [
    "PRIVATE_REGION,PRIVATE_STATUS,PRIVATE_AMOUNT",
    "east,PRIVATE_PAID,10",
    "east,PRIVATE_PAID,5",
    "west,PRIVATE_PAID,30",
    "west,pending,100",
    "",
  ].join("\n");
  await writeFile(path.join(root, "PRIVATE_ORDERS.csv"), source);
  return { root, source };
}
