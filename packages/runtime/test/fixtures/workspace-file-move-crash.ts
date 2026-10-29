import path from "node:path";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../../src/agent-runtime.js";
import { ModelRegistry } from "../../src/models.js";
import { LocalStore } from "../../src/store.js";
import { WorkspaceFileMutationManager } from "../../src/workspace-file-mutations.js";
import { HostDirectSandboxAdapter } from "../../src/sandbox-host-direct.js";
import { LocalPrivateCapsuleDurabilityUnavailableError, LocalPrivateCapsuleStore } from "../../src/local-private-capsule-store.js";

const [root, checkpoint = "after-rename"] = process.argv.slice(2);
if (!root) throw new Error("Fixture root is required");
const workspaceRoot = path.join(root, "workspace"), dataRoot = path.join(root, "data");
await mkdir(path.join(workspaceRoot, "source"), { recursive: true });
await mkdir(path.join(workspaceRoot, "target"), { recursive: true });
await writeFile(path.join(workspaceRoot, "source/source.txt"), "moved once\n");
const store = new LocalStore({ workspaceRoot, dataRoot });
await store.initialize();
if (checkpoint === "intent-storage-failure") await writeFile(path.join(dataRoot, "workspace-file-move-intents"), "not a directory");
if (checkpoint.startsWith("unsupported-directory-") || checkpoint.startsWith("intent-failure-")) {
  const put = LocalPrivateCapsuleStore.prototype.put;
  LocalPrivateCapsuleStore.prototype.put = async function (contentSha256, serialized) {
    if (this.rootPath !== path.join(dataRoot, "workspace-file-move-intents")) return put.call(this, contentSha256, serialized);
    await appendFile(path.join(root, "intent-put.log"), "put\n");
    const message = "Workspace file move intent capsule filesystem guarantees are unavailable on fixture platform";
    if (checkpoint.startsWith("unsupported-directory-")) throw new LocalPrivateCapsuleDurabilityUnavailableError(message);
    const fault = checkpoint.slice("intent-failure-".length);
    throw Object.assign(new Error(message), fault === "forged-name" ? { name: "LocalPrivateCapsuleDurabilityUnavailableError" }
      : fault === "plain" ? {} : { code: fault === "file-sync-ENOTSUP" ? "ENOTSUP" : fault });
  };
}
const manager = new WorkspaceFileMutationManager({ store, workspaceRoot, dataRoot, renameEntry: async (source, destination) => {
  await rename(source, destination);
  await appendFile(path.join(root, "renames.log"), "rename\n");
  if (checkpoint === "after-rename" || checkpoint === "unsupported-directory-after-rename") process.exit(73);
} });
await manager.initialize();
const provider = fauxProvider({ provider: "faux-move-recovery" });
provider.setResponses([
  fauxAssistantMessage(fauxToolCall("workspace_file_preview", { action: "preview", operation: "move",
    sourcePath: "source/source.txt", destinationPath: "target/moved.txt" }), { stopReason: "toolUse" }),
  (context) => {
    const previewId = JSON.stringify(context.messages).match(/filepreview_[a-z0-9]+/u)?.[0];
    if (!previewId) throw new Error("Move preview was not delivered");
    return fauxAssistantMessage(fauxToolCall("workspace_file_apply", { previewId }), { stopReason: "toolUse" });
  },
  fauxAssistantMessage(checkpoint === "unsupported-directory-completed"
    ? "The ordinary move completed without restart recovery." : "Unexpected continuation before interruption"),
  fauxAssistantMessage('{"facts":[]}'),
]);
const models = new ModelRegistry();
models.registerProvider(provider.provider);
const agent = await store.updateAgent(store.listAgents()[0]!.id, { model: { provider: "faux-move-recovery", id: "faux-1" },
  toolPolicy: "workspace", enabledTools: ["workspace_file_preview", "workspace_file_apply", "read_file"], enabledSubagents: [],
  automaticRecovery: { mode: "safe_read_only", maxAttempts: 3, backoffMs: 1000 } });
const thread = await store.createThread({ title: "Recover one native move", agentId: agent.id });
const append = store.appendEventOnceAtRunHead.bind(store);
store.appendEventOnceAtRunHead = async (input, options) => {
  const isMove = input.payload["route"] === "workspace_file_apply" || input.payload["toolName"] === "workspace_file_apply";
  if (checkpoint === "commit-gate-failure" && input.type === "workspace.file.move.commit_started") throw new Error("Injected move gate failure");
  if (checkpoint === "unsupported-directory-marker-failure" && input.type === "workspace.file.move.recovery_unavailable")
    throw new Error("Injected move unavailability marker persistence failure");
  if (checkpoint === "live-after-effect" && input.type === "tool.operation.settled" && isMove) {
    setInterval(() => undefined, 1000); process.stdout.write("move-ready\n"); await new Promise(() => undefined);
  }
  if ((checkpoint === "before-effect" && isMove && input.payload["executionEffectBoundary"] === true) ||
      (checkpoint === "after-evidence" && isMove && input.type === "tool.operation.settled") ||
      (checkpoint === "after-settlement" && isMove && input.type === "tool.completed")) process.exit(73);
  const receipt = await append(input, options);
  if ((checkpoint === "after-prepared" && input.type === "workspace.file.move.prepared") ||
      (checkpoint === "after-gate" && input.type === "workspace.file.move.commit_started")) process.exit(73);
  return receipt;
};
const run = await new AgentRuntime(store, models, undefined, new HostDirectSandboxAdapter(), undefined, manager).runPrompt({
  threadId: thread.id, text: "Move source/source.txt to target/moved.txt, then inspect it.",
  onEvent(event) {
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload) || event.payload["toolName"] !== "workspace_file_apply") return;
    if (checkpoint === "after-terminal" && event.type === "tool.completed") process.exit(73);
    if ((["intent-storage-failure", "commit-gate-failure", "unsupported-directory-marker-failure"].includes(checkpoint) ||
        checkpoint.startsWith("intent-failure-")) && event.type === "tool.failed") process.exit(73);
  },
});
if (checkpoint === "unsupported-directory-completed" && run.status === "completed") {
  await store.shutdown();
  process.exit(0);
}
throw new Error("The move crash checkpoint was not reached");
