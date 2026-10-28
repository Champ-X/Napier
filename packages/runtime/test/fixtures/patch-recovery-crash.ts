import { HostDirectSandboxAdapter } from "../../src/sandbox-host-direct.js";
import path from "node:path";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdir } from "node:fs/promises";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { AgentRuntime } from "../../src/agent-runtime.js";
import { ModelRegistry } from "../../src/models.js";
import { sha256 } from "../../src/ed25519.js";
import { LocalStore } from "../../src/store.js";

const [
  root,
  checkpoint = "after-terminal",
  operation = "create",
  recoveryMode = "safe_read_only",
  sequence = "single",
] = process.argv.slice(2);
if (!root) throw new Error("Fixture root is required");
const store = new LocalStore({
  dataRoot: path.join(root, "data"),
  workspaceRoot: path.join(root, "workspace"),
});
await mkdir(path.join(root, "workspace"), { recursive: true });
await store.initialize();
if (operation === "replace")
  await fs.promises.writeFile(
    path.join(root, "workspace/retained.txt"),
    "before\n",
  );
if (checkpoint === "after-file") {
  const link = fs.promises.link;
  fs.promises.link = async (...args) => {
    await link(...args);
    if (String(args[1]) === path.join(root, "workspace/retained.txt"))
      process.exit(73);
  };
  const rename = fs.promises.rename;
  fs.promises.rename = async (...args) => {
    await rename(...args);
    if (String(args[1]) === path.join(root, "workspace/retained.txt"))
      process.exit(73);
  };
  syncBuiltinESMExports();
}
if (checkpoint === "preparation-storage-failure") {
  await fs.promises.writeFile(
    path.join(root, "data/workspace-patch-intents"),
    "unavailable directory",
  );
}
const provider = fauxProvider({ provider: "faux-patch-recovery" });
provider.setResponses([
  fauxAssistantMessage(
    fauxToolCall(
      "apply_patch",
      operation === "replace"
        ? {
            operation: "replace",
            path: "retained.txt",
            expectedSha256: sha256("before\n"),
            edits: [
              {
                oldText: "before",
                newText: sequence === "chain" ? "middle" : "written once",
              },
            ],
          }
        : {
            operation: "create",
            path: "retained.txt",
            expectedSha256: null,
            content: "written once\n",
          },
    ),
    { stopReason: "toolUse" },
  ),
  ...(sequence === "chain"
    ? [
        fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: "retained.txt",
            expectedSha256: sha256("middle\n"),
            edits: [{ oldText: "middle", newText: "written once" }],
          }),
          { stopReason: "toolUse" },
        ),
      ]
    : []),
  fauxAssistantMessage("Unexpected continuation before interruption"),
]);
const registry = new ModelRegistry();
registry.registerProvider(provider.provider);
const agent = await store.updateAgent(store.listAgents()[0]!.id, {
  model: { provider: "faux-patch-recovery", id: "faux-1" },
  toolPolicy: "workspace",
  enabledTools: [
    "apply_patch",
    "read_file",
    ...(sequence === "process" ? ["run_command"] : []),
  ],
  enabledSubagents: [],
  automaticRecovery: {
    mode: recoveryMode as "safe_read_only" | "verified_patches",
    maxAttempts: 3,
    backoffMs: 1000,
  },
});
const thread = await store.createThread({
  title: "Retain settled patch",
  agentId: agent.id,
});
let startedCount = 0;
const append = store.appendEventOnceAtRunHead.bind(store);
store.appendEventOnceAtRunHead = async (input, options) => {
  if (input.type === "tool.started") startedCount++;
  if (sequence === "chain" && startedCount < 2) return append(input, options);
  if (
    checkpoint === "commit-marker-failure" &&
    input.type === "workspace.patch.commit_started"
  )
    throw new Error("Injected commit marker storage failure");
  if (
    checkpoint === "live-after-effect" &&
    input.type === "tool.operation.settled"
  ) {
    setInterval(() => undefined, 1000);
    process.stdout.write("patch-ready\n");
    await new Promise(() => undefined);
  }
  if (
    (checkpoint === "before-effect" &&
      input.payload["executionEffectBoundary"] === true) ||
    (checkpoint === "after-effect" &&
      input.type === "tool.operation.settled") ||
    (checkpoint === "after-settlement" && input.type === "tool.completed")
  )
    process.exit(73);
  const receipt = await append(input, options);
  if (
    checkpoint === "after-commit-marker" &&
    input.type === "workspace.patch.commit_started"
  )
    process.exit(73);
  if (
    checkpoint === "after-prepared" &&
    input.type === "workspace.patch.prepared"
  )
    process.exit(73);
  return receipt;
};
await new AgentRuntime(
  store,
  registry,
  undefined,
  sequence === "process" ? new HostDirectSandboxAdapter() : undefined,
).runPrompt({
  threadId: thread.id,
  text: "Create retained.txt, then inspect it.",
  onEvent(event) {
    if (
      ["preparation-storage-failure", "commit-marker-failure"].includes(
        checkpoint,
      ) &&
      event.type === "tool.failed"
    )
      process.exit(73);
    if (checkpoint === "after-terminal" && event.type === "tool.completed")
      process.exit(73);
  },
});
throw new Error("The crash checkpoint was not reached");
