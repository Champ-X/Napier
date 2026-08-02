import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  LocalStore,
  ModelRegistry,
  exportThreadReplayBundle,
  sha256,
  verifyThreadReplayBundle,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent DataFrame integration", () => {
  it("transforms private CSV and verifies the exact JSON Artifact", async () => {
    const fixture = await createFixture();
    const artifactPath = "reports/paid-summary.json";
    let planId = "";
    let sourceSha256 = "";
    let output = "";
    const provider = fauxProvider({ provider: "faux-data-frame" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("create_plan", {
          objective: "Transform paid order data into a verified summary.",
          steps: [
            {
              id: "transform",
              title: "Transform order data",
              description:
                "Inspect the CSV, run a typed DataFrame plan, and deliver JSON.",
              verification:
                "The complete JSON output is verified from workspace bytes.",
            },
          ],
          artifacts: [
            {
              id: "summary",
              path: artifactPath,
              kind: "file",
              description: "Paid revenue summary by region.",
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        planId =
          /"planId":"([^"]+)"/u.exec(JSON.stringify(context.messages))?.[1] ??
          "";
        return fauxAssistantMessage(
          fauxToolCall("update_plan_step", {
            planId,
            stepId: "transform",
            action: "start",
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        fauxToolCall("inspect_data", {
          path: "PRIVATE_ORDERS.csv",
          format: "csv",
          maxRows: 2,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        sourceSha256 =
          /"sha256":"([a-f0-9]{64})"/u.exec(
            JSON.stringify(context.messages),
          )?.[1] ?? "";
        expect(sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
        return fauxAssistantMessage(
          fauxToolCall("data_frame", {
            action: "transform",
            path: "PRIVATE_ORDERS.csv",
            sourceSha256,
            operations: [
              {
                type: "cast",
                column: "PRIVATE_AMOUNT",
                dataType: "number",
              },
              {
                type: "filter",
                column: "PRIVATE_STATUS",
                operator: "eq",
                value: "PRIVATE_PAID",
              },
              {
                type: "group",
                by: ["PRIVATE_REGION"],
                aggregations: [
                  {
                    operation: "sum",
                    column: "PRIVATE_AMOUNT",
                    as: "PRIVATE_TOTAL",
                  },
                  { operation: "count", as: "PRIVATE_ORDERS" },
                ],
              },
              {
                type: "sort",
                columns: [{ column: "PRIVATE_TOTAL", direction: "desc" }],
              },
            ],
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const toolOutput = collectStrings(context.messages).find((value) =>
          value.includes("DATAFRAME TABLE JSON"),
        );
        const start =
          toolOutput?.indexOf("{", toolOutput.indexOf("DATAFRAME")) ?? -1;
        output = start >= 0 ? toolOutput!.slice(start) : "";
        expect(JSON.parse(output)).toEqual({
          columns: ["PRIVATE_REGION", "PRIVATE_TOTAL", "PRIVATE_ORDERS"],
          rows: [
            ["west", 30, 1],
            ["east", 15, 2],
          ],
          rowCount: 2,
        });
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "create",
            path: artifactPath,
            expectedSha256: null,
            content: output,
            createParentDirectories: true,
          }),
          { stopReason: "toolUse" },
        );
      },
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_artifact", {
            planId,
            artifactId: "summary",
            action: "produced",
            evidence: "The complete DataFrame table JSON was written.",
          }),
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_artifact", {
            planId,
            artifactId: "summary",
            action: "verify",
            evidence: "Napier verified the JSON from workspace bytes.",
          }),
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_step", {
            planId,
            stepId: "transform",
            action: "complete",
            evidence:
              "The source hash, DataFrame plan, output, and Artifact are verified.",
          }),
          { stopReason: "toolUse" },
        ),
      fauxAssistantMessage(`The verified summary is at ${artifactPath}.`),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, fixture.registry);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Transform paid revenue by region into a verified JSON Artifact.",
      model: { provider: "faux-data-frame", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    await expect(
      readFile(path.join(fixture.workspaceRoot, artifactPath), "utf8"),
    ).resolves.toBe(output);
    expect(fixture.store.getPlan(planId)).toEqual(
      expect.objectContaining({
        status: "completed",
        artifacts: [
          expect.objectContaining({
            id: "summary",
            status: "verified",
            sha256: sha256(output),
            sourceRunId: run.id,
          }),
        ],
      }),
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    const dataEvents = events.filter(
      (event) =>
        event.type.startsWith("tool.") &&
        ["inspect_data", "data_frame"].includes(
          String(record(event.payload)?.["toolName"]),
        ),
    );
    expect(
      dataEvents
        .filter((event) => event.type === "tool.completed")
        .map((event) => record(event.payload)?.["toolName"]),
    ).toEqual(["inspect_data", "data_frame"]);
    expect(
      record(
        record(
          dataEvents.find(
            (event) =>
              event.type === "tool.completed" &&
              record(event.payload)?.["toolName"] === "data_frame",
          )?.payload,
        )?.["details"],
      ),
    ).toEqual(
      expect.objectContaining({
        kind: "napier.data-frame",
        sourceSha256,
        operationCount: 4,
        rowCount: 2,
        columnCount: 3,
      }),
    );
    const durable = JSON.stringify(dataEvents);
    for (const secret of [
      "PRIVATE_ORDERS",
      "PRIVATE_AMOUNT",
      "PRIVATE_STATUS",
      "PRIVATE_PAID",
      "PRIVATE_REGION",
      "PRIVATE_TOTAL",
      "west",
      "east",
      "DATAFRAME TABLE JSON",
    ]) {
      expect(durable).not.toContain(secret);
    }
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ).status,
    ).toBe("valid");
  }, 20_000);
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-data-frame-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_ORDERS.csv"),
    [
      "PRIVATE_REGION,PRIVATE_STATUS,PRIVATE_AMOUNT",
      "east,PRIVATE_PAID,10",
      "east,PRIVATE_PAID,5",
      "west,PRIVATE_PAID,30",
      "west,pending,100",
      "",
    ].join("\n"),
  );
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy: "workspace",
    enabledTools: ["inspect_data", "data_frame", "apply_patch"],
    enabledSkills: ["data-analysis"],
  });
  const thread = await store.createThread({
    title: "Agent DataFrame transformation",
    agentId: agent.id,
  });
  return {
    store,
    workspaceRoot,
    threadId: thread.id,
    registry: new ModelRegistry(),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (record(value)) {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
  return output;
}
