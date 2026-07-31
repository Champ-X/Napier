import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

describe("Agent SQLite query integration", () => {
  it("analyzes a real database and verifies a Plan artifact without durable row data", async () => {
    const fixture = await createFixture();
    const reportPath = "reports/region-summary.md";
    const report = [
      "# Region Summary",
      "",
      "Paid revenue totals 30 for west and 15 for east.",
      "",
      "The analysis used grouped SQL over the bound database version.",
      "",
    ].join("\n");
    let planId = "";
    let databaseSha256 = "";
    const provider = fauxProvider({ provider: "faux-sqlite-analysis" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("create_plan", {
          objective: "Analyze paid revenue and deliver a verified summary.",
          steps: [
            {
              id: "analyze",
              title: "Analyze revenue",
              description: "Query the SQLite database and write the result.",
              verification:
                "The report is verified from actual workspace bytes.",
            },
          ],
          artifacts: [
            {
              id: "summary",
              path: reportPath,
              kind: "file",
              description: "SQLite analysis summary.",
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
            stepId: "analyze",
            action: "start",
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        fauxToolCall("sqlite_query", {
          action: "schema",
          path: "PRIVATE_REVENUE_DATABASE.db",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        databaseSha256 =
          /Database SHA-256: ([a-f0-9]{64})/u.exec(
            JSON.stringify(context.messages),
          )?.[1] ?? "";
        expect(databaseSha256).toMatch(/^[a-f0-9]{64}$/u);
        return fauxAssistantMessage(
          fauxToolCall("sqlite_query", {
            action: "query",
            path: "PRIVATE_REVENUE_DATABASE.db",
            databaseSha256,
            sql: "SELECT region, SUM(amount) AS PRIVATE_TOTAL FROM PRIVATE_ORDERS WHERE status = ? GROUP BY region ORDER BY PRIVATE_TOTAL DESC",
            params: ["PRIVATE_PAID_STATUS"],
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain('\\"region\\": \\"west\\"');
        expect(messages).toContain('\\"PRIVATE_TOTAL\\": \\"30\\"');
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "create",
            path: reportPath,
            expectedSha256: null,
            content: report,
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
            evidence: "The grouped SQLite analysis report was written.",
          }),
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_artifact", {
            planId,
            artifactId: "summary",
            action: "verify",
            evidence: "Napier verified the report from workspace bytes.",
          }),
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_step", {
            planId,
            stepId: "analyze",
            action: "complete",
            evidence:
              "The database version, aggregate result, and report artifact were verified.",
          }),
          { stopReason: "toolUse" },
        ),
      fauxAssistantMessage(`The verified analysis is at ${reportPath}.`),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, fixture.registry);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Analyze paid revenue by region and write a report.",
      model: { provider: "faux-sqlite-analysis", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    await expect(
      readFile(path.join(fixture.workspaceRoot, reportPath), "utf8"),
    ).resolves.toBe(report);
    expect(fixture.store.getPlan(planId)).toEqual(
      expect.objectContaining({
        status: "completed",
        artifacts: [
          expect.objectContaining({
            id: "summary",
            status: "verified",
            sha256: sha256(report),
            sourceRunId: run.id,
          }),
        ],
      }),
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    const sqliteEvents = events.filter(
      (event) =>
        event.type.startsWith("tool.") &&
        record(event.payload)?.["toolName"] === "sqlite_query",
    );
    expect(
      sqliteEvents
        .filter((event) => event.type === "tool.completed")
        .map((event) => record(record(event.payload)?.["details"])?.["action"]),
    ).toEqual(["schema", "query"]);
    const durable = JSON.stringify(sqliteEvents);
    for (const secret of [
      "PRIVATE_REVENUE_DATABASE",
      "PRIVATE_ORDERS",
      "PRIVATE_TOTAL",
      "PRIVATE_PAID_STATUS",
      "west",
      "east",
    ]) {
      expect(durable).not.toContain(secret);
    }
  });

  it("renders a real SQLite chart and verifies the exact SVG artifact", async () => {
    const fixture = await createFixture();
    const chartPath = "reports/paid-revenue.svg";
    let planId = "";
    let databaseSha256 = "";
    let svg = "";
    const provider = fauxProvider({ provider: "faux-sqlite-chart" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("create_plan", {
          objective: "Render and verify paid revenue by region.",
          steps: [
            {
              id: "chart",
              title: "Create chart",
              description:
                "Query the bound SQLite database and create an SVG chart.",
              verification: "The SVG is verified from actual workspace bytes.",
            },
          ],
          artifacts: [
            {
              id: "chart",
              path: chartPath,
              kind: "file",
              description: "Paid revenue chart.",
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
            stepId: "chart",
            action: "start",
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        fauxToolCall("sqlite_query", {
          action: "schema",
          path: "PRIVATE_REVENUE_DATABASE.db",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        databaseSha256 =
          /Database SHA-256: ([a-f0-9]{64})/u.exec(
            JSON.stringify(context.messages),
          )?.[1] ?? "";
        return fauxAssistantMessage(
          fauxToolCall("sqlite_query", {
            action: "chart",
            path: "PRIVATE_REVENUE_DATABASE.db",
            databaseSha256,
            sql: "SELECT region AS PRIVATE_REGION, SUM(amount) AS PRIVATE_PAID_TOTAL FROM PRIVATE_ORDERS WHERE status = ? GROUP BY region ORDER BY PRIVATE_PAID_TOTAL DESC",
            params: ["PRIVATE_PAID_STATUS"],
            chart: {
              type: "bar",
              xColumn: "PRIVATE_REGION",
              yColumn: "PRIVATE_PAID_TOTAL",
              title: "PRIVATE Paid revenue by region",
              xLabel: "PRIVATE Region",
              yLabel: "PRIVATE Revenue",
            },
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const output = collectStrings(context.messages).find((value) =>
          value.includes("SQLITE CHART SVG"),
        );
        const start = output?.indexOf("<svg") ?? -1;
        svg = start >= 0 ? output!.slice(start) : "";
        expect(svg).toContain("PRIVATE Paid revenue by region");
        expect(svg).toContain("</svg>");
        expect(svg).not.toContain("<script");
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "create",
            path: chartPath,
            expectedSha256: null,
            content: svg,
            createParentDirectories: true,
          }),
          { stopReason: "toolUse" },
        );
      },
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_artifact", {
            planId,
            artifactId: "chart",
            action: "produced",
            evidence: "The deterministic SQLite chart SVG was written.",
          }),
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_artifact", {
            planId,
            artifactId: "chart",
            action: "verify",
            evidence: "Napier verified the SVG from workspace bytes.",
          }),
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          fauxToolCall("update_plan_step", {
            planId,
            stepId: "chart",
            action: "complete",
            evidence:
              "The database version, chart receipt, and SVG artifact were verified.",
          }),
          { stopReason: "toolUse" },
        ),
      fauxAssistantMessage(`The verified chart is at ${chartPath}.`),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, fixture.registry);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Chart paid revenue by region as a verified SVG.",
      model: { provider: "faux-sqlite-chart", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    await expect(
      readFile(path.join(fixture.workspaceRoot, chartPath), "utf8"),
    ).resolves.toBe(svg);
    expect(fixture.store.getPlan(planId)).toEqual(
      expect.objectContaining({
        status: "completed",
        artifacts: [
          expect.objectContaining({
            id: "chart",
            status: "verified",
            sha256: sha256(svg),
            sourceRunId: run.id,
          }),
        ],
      }),
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    const sqliteEvents = events.filter(
      (event) =>
        event.type.startsWith("tool.") &&
        record(event.payload)?.["toolName"] === "sqlite_query",
    );
    expect(
      sqliteEvents
        .filter((event) => event.type === "tool.completed")
        .map((event) => {
          const details = record(record(event.payload)?.["details"]);
          return [details?.["kind"], details?.["action"]];
        }),
    ).toEqual([
      ["napier.sqlite-query", "schema"],
      ["napier.sqlite-chart", "chart"],
    ]);
    const durable = JSON.stringify(sqliteEvents);
    for (const secret of [
      "PRIVATE_REVENUE_DATABASE",
      "PRIVATE_ORDERS",
      "PRIVATE_REGION",
      "PRIVATE_PAID_TOTAL",
      "PRIVATE_PAID_STATUS",
      "PRIVATE Paid revenue",
      "<svg",
      "west",
      "east",
    ]) {
      expect(durable).not.toContain(secret);
    }
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ).status,
    ).toBe("valid");
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-sqlite-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const database = new DatabaseSync(
    path.join(workspaceRoot, "PRIVATE_REVENUE_DATABASE.db"),
  );
  database.exec(`
    CREATE TABLE PRIVATE_ORDERS (
      id INTEGER PRIMARY KEY,
      region TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL
    ) STRICT;
    INSERT INTO PRIVATE_ORDERS VALUES
      (1, 'east', 'PRIVATE_PAID_STATUS', 10),
      (2, 'east', 'PRIVATE_PAID_STATUS', 5),
      (3, 'west', 'PRIVATE_PAID_STATUS', 30),
      (4, 'west', 'pending', 100);
  `);
  database.close();
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy: "workspace",
    enabledTools: ["sqlite_query", "apply_patch"],
    enabledSkills: ["data-analysis"],
  });
  const thread = await store.createThread({
    title: "Agent SQLite analysis",
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
