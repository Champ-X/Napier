import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { bindRunHarnessProfile } from "../src/model-harness-experiment-profile.js";
import {
  inheritedHarnessPolicyOptions,
  recordRunHarnessPolicy,
} from "../src/harness-run-policy.js";
import { remapImportedEventPayload } from "../src/thread-import-event-payload.js";

it("preserves the exact Harness policy across portable Run identity changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-harness-import-"));
  const store = new LocalStore({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
  });
  try {
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Portable policy",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: agent.model,
    });
    const profile = bindRunHarnessProfile({
      harnessPolicyPreset: "coding-python.v1",
    }).harnessExperimentProfile!;
    await recordRunHarnessPolicy(run, profile, (event) =>
      store.appendEvent(event),
    );
    await store.finishRun(run.id, "failed");
    const bundle = await exportThreadReplayBundle(store, thread.id);
    const original = structuredClone(bundle);
    const imported = await store.importThreadReplayBundle(bundle);
    const importedRun = imported.runs[0]!;
    expect(importedRun.id).not.toBe(run.id);
    expect(
      inheritedHarnessPolicyOptions(imported.events, importedRun.id)
        .harnessExperimentProfile,
    ).toEqual(profile);
    const second = await store.importThreadReplayBundle(
      await exportThreadReplayBundle(store, imported.thread.id),
    );
    expect(
      inheritedHarnessPolicyOptions(second.events, second.runs[0]!.id)
        .harnessExperimentProfile,
    ).toEqual(profile);
    expect(bundle).toEqual(original);
    const binding = bundle.events.find(
      (event) => event.type === "harness.policy.bound",
    )!;
    const corrupt = {
      ...(binding.payload as Record<string, string>),
      profileSha256: "0".repeat(64),
    };
    expect(() =>
      remapImportedEventPayload(
        binding.type,
        corrupt,
        new Map([[run.id, importedRun.id]]),
      ),
    ).toThrow(/invalid|mismatch/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
