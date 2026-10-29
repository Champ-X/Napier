import path from "node:path";
import { appendFile, link, mkdir, rename, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type Context } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../../src/agent-runtime.js";
import { ModelRegistry } from "../../src/models.js";
import { LocalStore } from "../../src/store.js";
import { WorkspaceFileMutationManager } from "../../src/workspace-file-mutations.js";
import { HostDirectSandboxAdapter } from "../../src/sandbox-host-direct.js";
import { sha256 } from "../../src/ed25519.js";

const [root, shape = "moves", checkpoint = "settled", mode = "safe_read_only"] = process.argv.slice(2);
if (!root) throw new Error("Fixture root is required");
const workspaceRoot = path.join(root, "workspace"), dataRoot = path.join(root, "data");
for (const part of ["source-a", "target-a", "source-b", "target-b"])
  await mkdir(path.join(workspaceRoot, part), { recursive: true });
await writeFile(path.join(workspaceRoot, "source-a/source.txt"), "move a once\n");
if (shape === "hardlinks") await link(path.join(workspaceRoot, "source-a/source.txt"), path.join(workspaceRoot, "source-b/source.txt"));
else await writeFile(path.join(workspaceRoot, "source-b/source.txt"), "move b once\n");
await writeFile(path.join(workspaceRoot, "patched.txt"), "before\n");
const store = new LocalStore({ workspaceRoot, dataRoot }); await store.initialize();
const manager = new WorkspaceFileMutationManager({ store, workspaceRoot, dataRoot,
  renameEntry: async (source, destination) => {
    await rename(source, destination);
    await appendFile(path.join(root, "renames.log"), "rename\n");
  } });
await manager.initialize();
const provider = fauxProvider({ provider: "faux-operation-batch" });
const preview = (letter: string) => fauxToolCall("workspace_file_preview", {
  action: "preview", operation: "move", sourcePath: shape === "chain" && letter === "b" ? "target-a/moved.txt" : `source-${letter}/source.txt`,
  destinationPath: `target-${letter}/moved.txt`,
});
const patch = () => fauxToolCall("apply_patch", { operation: "replace", path: "patched.txt", expectedSha256: sha256("before\n"),
  edits: [{ oldText: "before", newText: "patched once" }] });
const apply = (messages: unknown) => {
  const previewId = [...JSON.stringify(messages).matchAll(/filepreview_[a-z0-9]+/gu)].at(-1)?.[0];
  if (!previewId) throw new Error("Missing native preview");
  return fauxToolCall("workspace_file_apply", { previewId });
};
// Native write tools are mutually exclusive. Preserve actual earlier settled
// participants while crashing the last native operation at its real boundary.
provider.setResponses([
  ...(shape === "mixed" ? [fauxAssistantMessage(patch(), { stopReason: "toolUse" })] : [
    fauxAssistantMessage(preview("a"), { stopReason: "toolUse" }),
    (context: Context) => fauxAssistantMessage(apply(context.messages), { stopReason: "toolUse" }),
  ]),
  ...(shape === "mixed-reverse" ? [fauxAssistantMessage(patch(), { stopReason: "toolUse" })] : [
    fauxAssistantMessage(preview("b"), { stopReason: "toolUse" }),
    (context: Context) => fauxAssistantMessage(apply(context.messages), { stopReason: "toolUse" }),
  ]),
]);
const models = new ModelRegistry(); models.registerProvider(provider.provider);
const agent = await store.updateAgent(store.listAgents()[0]!.id, {
  model: { provider: "faux-operation-batch", id: "faux-1" }, toolPolicy: "workspace",
  enabledTools: ["workspace_file_preview", "workspace_file_apply", "apply_patch", "read_file"], enabledSubagents: [],
  automaticRecovery: { mode: mode as "safe_read_only" | "verified_patches", maxAttempts: 3, backoffMs: 1000 },
});
const thread = await store.createThread({ title: "Native independent operation batch", agentId: agent.id });
let completed = 0;
const crash = () => {
  writeFileSync(path.join(root, "crash.json"), JSON.stringify({ runId: store.listRuns(thread.id)[0]!.id,
    threadId: thread.id, providerCalls: provider.state.callCount, completed, exitCode: 73 }));
  process.exit(73);
};
const append = store.appendEventOnceAtRunHead.bind(store);
store.appendEventOnceAtRunHead = async (input, options) => {
  const native = input.payload["route"] === "workspace_file_apply" || input.payload["route"] === "apply_patch";
  if (input.type === "tool.operation.settled" && native) {
    if (completed === 1 && checkpoint === "after-effect") crash();
  }
  const result = await append(input, options);
  if (["workspace.file.move.prepared", "workspace.patch.prepared"].includes(input.type)) {
    if (completed === 1 && checkpoint === "before-commit") crash();
  }
  return result;
};
await new AgentRuntime(store, models, undefined, new HostDirectSandboxAdapter(), undefined, manager).runPrompt({
  threadId: thread.id, text: "Perform both independent operations exactly once, then inspect their results.",
  onEvent(event) {
    if (event.type === "tool.completed" && ["workspace_file_apply", "apply_patch"].includes(String((event.payload as Record<string, unknown>)["toolName"]))) {
      completed++;
      if (checkpoint === "settled" && completed === 2) crash();
    }
  },
});
throw new Error("Batch crash barrier was not reached");
