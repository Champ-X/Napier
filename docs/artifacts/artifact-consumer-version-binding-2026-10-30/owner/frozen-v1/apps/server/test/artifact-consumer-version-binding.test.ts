import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { LocalStore } from "../../../packages/runtime/src/store.js";
import { registerPlanArtifactFileHttp } from "../src/plan-artifact-file-http.js";
import {
  downloadPlanArtifactFile,
  peekPlanArtifactFile,
} from "../../web/src/artifact-file-api.js";
import { assertArtifactReceiptVersion } from "../../web/src/artifact-version-binding.js";

it("binds actual SQLite/Hono preview and download bytes to the selected manifest revision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-artifact-consumer-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  try {
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Version read",
      agentId: agent.id,
    });
    const plan = await store.createPlan(thread.id, {
      objective: "Deliver report",
      steps: [
        {
          id: "write",
          title: "Write",
          description: "Write report",
          verification: "Read bytes",
        },
      ],
      artifacts: [{ id: "report", path: "report.txt", description: "Report" }],
    });
    await writeFile(path.join(workspaceRoot, "report.txt"), "old");
    await store.updatePlanArtifact(plan.id, "report", {
      status: "produced",
      evidence: "Written",
    });
    const first = await store.updatePlanArtifact(plan.id, "report", {
      status: "verified",
      evidence: "Recorded old",
      sha256: hash("old"),
      sizeBytes: 3,
    });
    const selection = {
      threadId: thread.id,
      planId: plan.id,
      planRevision: first.revision,
      artifact: structuredClone(first.artifacts[0]!),
    };
    const app = new Hono();
    registerPlanArtifactFileHttp(app, store);
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      app.request(url, init),
    );
    const oldReceipt = await peekPlanArtifactFile(thread.id, plan.id, "report");
    expect(() =>
      assertArtifactReceiptVersion(selection, oldReceipt),
    ).not.toThrow();
    await writeFile(path.join(workspaceRoot, "report.txt"), "new bytes");
    const next = await store.updatePlanArtifact(plan.id, "report", {
      status: "verified",
      evidence: "Recorded new",
      sha256: hash("new bytes"),
      sizeBytes: 9,
    });
    const current = {
      ...selection,
      planRevision: next.revision,
      artifact: next.artifacts[0]!,
    };
    const newReceipt = await peekPlanArtifactFile(thread.id, plan.id, "report");
    expect(newReceipt.planRevision).toBe(next.revision);
    expect(await newReceipt.blob.text()).toBe("new bytes");
    expect(() => assertArtifactReceiptVersion(selection, newReceipt)).toThrow(
      "different artifact version",
    );
    expect(() =>
      assertArtifactReceiptVersion(current, newReceipt),
    ).not.toThrow();
    const download = await downloadPlanArtifactFile(
      thread.id,
      plan.id,
      "report",
    );
    expect(() => assertArtifactReceiptVersion(selection, download)).toThrow(
      "different artifact version",
    );
    expect(() => assertArtifactReceiptVersion(current, download)).not.toThrow();
    expect(await download.blob.text()).toBe("new bytes");
    expect(
      (await store.listEvents(thread.id)).some(
        (event) => event.type === "artifact.exported",
      ),
    ).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    await store.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
