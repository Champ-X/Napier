import { cp, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApprovalFixture, openWorkflowFixture } from "../../../packages/runtime/test/fixtures/workflow-approval-recovery-setup.js";
import { WorkspaceRuntimeCatalog } from "../src/workspace-runtime-catalog.js";
import { resolveWorkspaceRuntimeIdentity } from "../src/workspace-runtime-identity.js";
import { recordRecentWorkspace } from "../src/recent-workspaces.js";

/** Closed SQLite copies deliberately retain thread/plan/decision/extension IDs. */
export async function seedWorkspaceApprovalReview(directory: string) {
  const root = await realpath(directory);
  const seeded = await createApprovalFixture(root, false, 3_600_000);
  const extension = await seeded.store.createMcpExtension({
    name: "Copied trust review",
    description: "An inert extension; this acceptance never connects or enables it.",
    transport: { type: "stdio", command: process.execPath, args: ["--version"] },
    requestedCapabilities: ["workspace.read"],
  });
  await seeded.store.shutdown();
  const bRoot = path.join(root, "project-b");
  const bData = path.join(root, "custom-ledger-b");
  await mkdir(bRoot, { recursive: true });
  await cp(path.join(root, "data"), bData, { recursive: true });

  // These records are added after the copy and are therefore absent from B.
  const aOnly = await openWorkflowFixture(root);
  let absent;
  try {
    const waiting = await aOnly.embedded.run({ manifest: seeded.request.manifest, input: {} });
    const extraExtension = await aOnly.store.createMcpExtension({
      name: "A only trust review",
      transport: { type: "stdio", command: process.execPath, args: ["--version"] },
      requestedCapabilities: ["workspace.read"],
    });
    if (!waiting.pendingDecision) throw new Error("Missing A-only waiting decision");
    absent = {
      threadId: waiting.threadId,
      planId: waiting.result.planId,
      decisionId: waiting.pendingDecision.id,
      extensionId: extraExtension.id,
    };
  } finally { await aOnly.store.shutdown(); }
  // Production index uses state as A's data root; B retains a custom data root.
  await cp(path.join(root, "data"), path.join(root, "state"), { recursive: true });
  const catalog = await WorkspaceRuntimeCatalog.open(path.join(root, "state"));
  try {
    const a = catalog.register(await resolveWorkspaceRuntimeIdentity(path.join(root, "workspace"), path.join(root, "state")));
    const b = catalog.register(await resolveWorkspaceRuntimeIdentity(bRoot, bData));
    await recordRecentWorkspace(b.root, path.join(root, "state"));
    await recordRecentWorkspace(a.root, path.join(root, "state"));
    return {
      a, b, absent,
      request: {
        threadId: seeded.request.threadId, planId: seeded.request.planId,
        decisionId: seeded.request.decisionId, answer: seeded.request.answer,
      },
      extension: { id: extension.id, name: extension.name, revision: extension.revision },
    };
  } finally { catalog.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) throw new Error("Expected an isolated fixture directory");
  await writeFile(path.join(root, "approval-review-fixture.json"), JSON.stringify(await seedWorkspaceApprovalReview(root), null, 2) + "\n", { flag: "wx" });
}
