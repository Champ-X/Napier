import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { UnsupportedSandboxAdapter } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.workspaceProcesses.shutdown();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SQLite chart HTTP Agent path", () => {
  it("streams a real chart receipt while SVG and data remain live-only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-chart-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const database = new DatabaseSync(
      path.join(workspaceRoot, "PRIVATE_HTTP_CHART.db"),
    );
    database.exec(`
      CREATE TABLE PRIVATE_METRICS (
        category TEXT NOT NULL,
        value INTEGER NOT NULL
      ) STRICT;
      INSERT INTO PRIVATE_METRICS VALUES
        ('PRIVATE_ALPHA', 10),
        ('PRIVATE_ALPHA', 20),
        ('PRIVATE_BETA', 15);
    `);
    database.close();
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: new UnsupportedSandboxAdapter("server-sqlite-chart"),
    });
    openServices.push(services);
    const app = createApp(services);
    const agentId = services.store.listAgents()[0]!.id;
    expect(
      (
        await app.request(`/api/agents/${agentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolPolicy: "workspace",
            enabledTools: ["sqlite_query"],
            enabledSkills: ["data-analysis"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "HTTP SQLite chart",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-sqlite-chart" });
    let databaseSha256 = "";
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("sqlite_query", {
          action: "schema",
          path: "PRIVATE_HTTP_CHART.db",
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
            path: "PRIVATE_HTTP_CHART.db",
            databaseSha256,
            sql: "SELECT category AS PRIVATE_CATEGORY, SUM(value) AS PRIVATE_TOTAL FROM PRIVATE_METRICS GROUP BY category ORDER BY PRIVATE_TOTAL DESC",
            chart: {
              type: "bar",
              xColumn: "PRIVATE_CATEGORY",
              yColumn: "PRIVATE_TOTAL",
              title: "PRIVATE HTTP chart",
            },
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const live = collectStrings(context.messages).join("\n");
        expect(live).toContain("<svg");
        expect(live).toContain("PRIVATE HTTP chart");
        expect(live).toContain("PRIVATE_ALPHA");
        return fauxAssistantMessage(
          "The chart was rendered from the bound SQLite snapshot.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Render the requested SQLite chart.",
        model: { provider: "faux-server-sqlite-chart", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    expect(stream).not.toContain("<svg");
    expect(stream).not.toContain("PRIVATE_HTTP_CHART");
    expect(stream).not.toContain("PRIVATE_ALPHA");
    const events = await services.store.listEvents(thread.id);
    const chart = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "sqlite_query" &&
        record(record(event.payload)?.["details"])?.["action"] === "chart",
    );
    expect(record(record(chart?.payload)?.["details"])).toEqual(
      expect.objectContaining({
        kind: "napier.sqlite-chart",
        chartType: "bar",
        pointCount: 2,
        svgSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain("<svg");
    expect(durable).not.toContain("PRIVATE_HTTP_CHART");
    expect(durable).not.toContain("PRIVATE_ALPHA");
  }, 20_000);
});

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

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
