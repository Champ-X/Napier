import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalStore } from "@napier/runtime/store";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerPlanArtifactFileHttp } from "../src/plan-artifact-file-http.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("artifact file preview with the persistent Ledger", () => {
  it.each([
    ["image.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    [
      "file.constructor",
      "application/octet-stream",
      Buffer.from([0xff, 0xfe, 0]),
    ],
    [
      "file.__proto__",
      "application/octet-stream",
      Buffer.from([0xff, 0xfe, 0]),
    ],
    [
      "report.pdf",
      "application/pdf",
      Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff]),
    ],
  ])(
    "persists and reopens a hash-only preview receipt for %s",
    async (filename, contentType, contents) => {
      const root = await mkdtemp(path.join(tmpdir(), "napier-preview-ledger-"));
      roots.push(root);
      const options = {
        dataRoot: path.join(root, "data"),
        workspaceRoot: path.join(root, "workspace"),
      };
      await mkdir(options.workspaceRoot);
      await writeFile(path.join(options.workspaceRoot, filename), contents);
      const store = new LocalStore(options);
      stores.push(store);
      await store.initialize();
      const agent = store.listAgents()[0]!;
      const thread = await store.createThread({
        title: "File preview",
        agentId: agent.id,
      });
      const run = await store.createRun({
        threadId: thread.id,
        agentId: agent.id,
      });
      let plan = await store.createPlan(thread.id, {
        objective: "Preview a retained binary artifact",
        steps: [
          {
            id: "preview",
            title: "Inspect file",
            description: "Inspect the artifact bytes",
            verification: "Retain the file digest",
          },
        ],
        artifacts: [
          { id: "result", path: filename, description: "Binary output" },
        ],
      });
      await store.updatePlanArtifact(plan.id, "result", {
        status: "produced",
        sourceRunId: run.id,
        evidence: "File is present",
      });
      const sha256 = createHash("sha256").update(contents).digest("hex");
      plan = await store.updatePlanArtifact(plan.id, "result", {
        status: "verified",
        sourceRunId: run.id,
        evidence: "Digest recorded",
        sha256,
        sizeBytes: contents.byteLength,
      });
      await store.finishRun(run.id, "completed");
      const app = new Hono();
      registerPlanArtifactFileHttp(app, store);
      const endpoint = `/api/threads/${thread.id}/plans/${plan.id}/artifacts/result/preview-file`;
      const before = await store.listEvents(thread.id);

      const peek = await app.request(`${endpoint}/peek`);
      expect(peek.status).toBe(200);
      expect(peek.headers.get("X-Napier-Read-Mode")).toBe("peek");
      expect(await store.listEvents(thread.id)).toEqual(before);

      const response = await app.request(endpoint);
      expect(
        response.status,
        response.status === 200 ? "" : await response.text(),
      ).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(contents);
      expect(response.headers.get("Content-Type")).toBe(contentType);
      const events = await store.listEvents(thread.id);
      const event = events.find(
        (candidate) =>
          candidate.id === response.headers.get("X-Napier-Ledger-Event-Id"),
      );
      expect(event).toMatchObject({
        type: "artifact.previewed",
        payload: {
          previewKind: "file",
          contentType,
          sha256,
          sizeBytes: contents.byteLength,
          planRevision: plan.revision,
        },
      });
      expect(response.headers.get("X-Napier-Ledger-Event-SHA256")).toBe(
        createHash("sha256").update(JSON.stringify(event)).digest("hex"),
      );
      expect(event!.payload).not.toHaveProperty("contents");
      expect(events).toHaveLength(before.length + 1);

      await writeFile(
        path.join(options.workspaceRoot, filename),
        "drifted bytes",
      );
      expect((await app.request(endpoint)).status).toBe(400);
      expect(await store.listEvents(thread.id)).toEqual(events);
      store.close();
      const reopened = new LocalStore(options);
      stores.push(reopened);
      await reopened.initialize();
      expect(await reopened.listEvents(thread.id)).toEqual(events);
    },
  );
});
