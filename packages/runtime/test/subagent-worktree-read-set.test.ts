import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { createOwnedToolRecordV2 } from "../src/owned-tool-protocol.js";
import { LocalStore } from "../src/store.js";
import { governSubagentTools } from "../src/subagent-tool-execution.js";
import { trackWorktreeReads } from "../src/subagent-worktree-read-set.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { createWorkspaceTools } from "../src/tools.js";
import { deliveryManager } from "./subagent-worktree-delivery-fixture.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("coder worktree read-tracking identity", () => {
  it("admits real coder tools and reads the edited private candidate through the durable execution path", async () => {
    const fixture = await harness();
    const coderTools = fixture.manager.createCoderTools(fixture.session);
    const tools = governSubagentTools({ tools: coderTools, store: fixture.store, run: fixture.run,
      taskId: fixture.session.taskId, executionId: "execution_readset", concurrencyGate: new ToolConcurrencyGate(), onEvent: undefined });
    const patch = tools.find((tool) => tool.name === "apply_patch")!;
    const read = tools.find((tool) => tool.name === "read_file")!;
    await patch.execute("provider_patch", {
      operation: "replace", path: "value.txt", expectedSha256: sha256("parent value\n"),
      edits: [{ oldText: "parent value", newText: "private candidate value" }],
    });
    expect(fixture.session.readScopes).toEqual([]);
    const result = await read.execute("provider_read", { path: "value.txt" });
    expect(JSON.stringify(result.content)).toContain("private candidate value");
    expect(fixture.session.readScopes).toEqual([{ path: "value.txt", kind: "file" }]);
    expect(await readFile(path.join(fixture.workspaceRoot, "value.txt"), "utf8")).toBe("parent value\n");
    const events = await fixture.store.listRunEvents(fixture.run.id);
    for (const type of ["tool.admitted", "tool.started", "tool.completed"]) {
      const matching = events.filter((event) => event.type === type);
      expect(matching).toHaveLength(2);
      expect(matching.map((event) => {
        const payload = event.payload;
        if (payload === null || typeof payload !== "object" || Array.isArray(payload))
          throw new Error("Tool lifecycle payload must be an object");
        return payload["providerCallId"];
      })).toEqual(["provider_patch", "provider_read"]);
    }
    await expect(patch.execute("provider_forbidden", {
      operation: "replace", path: "other.txt", expectedSha256: sha256("untouched\n"),
      edits: [{ oldText: "untouched", newText: "forbidden" }],
    })).rejects.toThrow("Coder Subagent apply_patch is limited");
    expect(await readFile(path.join(fixture.session.root, "other.txt"), "utf8")).toBe("untouched\n");
  });

  it("retains native read policy while binding the decorator and rejecting later execute replacement", async () => {
    const fixture = await harness();
    const raw = createWorkspaceTools(fixture.session.root).find((tool) => tool.name === "read_file")!;
    const original = createOwnedToolRecordV2(raw);
    const tracked = trackWorktreeReads([raw], fixture.session)[0]!;
    const protocol = createOwnedToolRecordV2(tracked);
    expect(protocol.definition.compatibility?.mode).toBe("native");
    for (const key of ["sideEffect", "concurrency", "idempotency", "approval", "capabilityUris"] as const)
      expect(protocol.definition[key]).toEqual(original.definition[key]);
    expect(protocol.implementationSha256).not.toBe(original.implementationSha256);
    expect(tracked.prepareArguments).toBe(raw.prepareArguments);
    await tracked.execute("tracked_read", { path: "value.txt" });
    expect(fixture.session.readScopes).toEqual([{ path: "value.txt", kind: "file" }]);
    tracked.execute = raw.execute;
    expect(() => protocol.assertCurrentIdentity()).toThrow();
  });
});

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-readset-identity-")); roots.push(root);
  const workspaceRoot = path.join(root, "workspace"), dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, "value.txt"), "parent value\n");
  await writeFile(path.join(workspaceRoot, "other.txt"), "untouched\n");
  const store = new LocalStore({ workspaceRoot, dataRoot }); stores.push(store); await store.initialize();
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({ title: "Read-tracking identity", agentId });
  const { run } = await store.createLeasedRun({ threadId: thread.id, agentId }, { ownerId: `process:${process.pid}:readset`, ttlMs: 60_000 });
  const manager = deliveryManager({ workspaceRoot, dataRoot });
  const session = await manager.createWorktree("task_readset123", ["value.txt"]);
  return { workspaceRoot, store, run, manager, session };
}
