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
  sha256,
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
