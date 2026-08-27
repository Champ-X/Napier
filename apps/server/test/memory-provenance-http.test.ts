import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { MemoryFact, ThreadDetail } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";

describe("memory HTTP provenance", () => {
  it("binds explicit persistence context and task identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-memory-http-"));
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
      sandbox: processReadySandbox("memory-provenance-http"),
    });
    try {
      const app = createApp(services);
      const created = (await (
        await app.request("/api/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Memory provenance API test" }),
        })
      ).json()) as ThreadDetail;
      const response = await app.request("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "The project requires reversible migrations.",
          category: "constraint",
          scope: "workspace",
          persistenceReason: "This constraint applies to future migrations.",
          differenceSummary: "Adds a migration constraint.",
          threadId: created.thread.id,
        }),
      });

      expect(response.status).toBe(201);
      const proposed = (await response.json()) as MemoryFact;
      expect(proposed.source).toEqual(
        expect.objectContaining({
          type: "manual",
          threadId: created.thread.id,
          taskTitle: created.thread.title,
          persistenceReason: "This constraint applies to future migrations.",
          differenceSummary: "Adds a migration constraint.",
          repositoryEvidence: { status: "unavailable" },
        }),
      );
      const invalid = await app.request("/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "Invalid provenance must not be stored.",
          persistenceReason: "   ",
        }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      await services.recovery.stop();
      await services.automation.stop();
      await services.channels.stop();
      await services.workspaceProcesses.shutdown();
      await services.extensions.shutdown();
      services.store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
