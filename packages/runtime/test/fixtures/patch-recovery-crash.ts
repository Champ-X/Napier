import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { AgentRuntime } from "../../src/agent-runtime.js";
import { ModelRegistry } from "../../src/models.js";
import { LocalStore } from "../../src/store.js";

const [root, checkpoint = "after-terminal"] = process.argv.slice(2);
if (!root) throw new Error("Fixture root is required");
const store = new LocalStore({
  dataRoot: path.join(root, "data"),
  workspaceRoot: path.join(root, "workspace"),
});
await mkdir(path.join(root, "workspace"), { recursive: true });
await store.initialize();
const provider = fauxProvider({ provider: "faux-patch-recovery" });
provider.setResponses([
  fauxAssistantMessage(
    fauxToolCall("apply_patch", {
      operation: "create",
      path: "retained.txt",
      expectedSha256: null,
      content: "written once\n",
    }),
    { stopReason: "toolUse" },
  ),
  fauxAssistantMessage("Unexpected continuation before interruption"),
]);
const registry = new ModelRegistry();
registry.registerProvider(provider.provider);
const agent = await store.updateAgent(store.listAgents()[0]!.id, {
  model: { provider: "faux-patch-recovery", id: "faux-1" },
  toolPolicy: "workspace",
  enabledTools: ["apply_patch", "read_file"],
  enabledSubagents: [],
  automaticRecovery: {
    mode: "safe_read_only",
    maxAttempts: 2,
    backoffMs: 1000,
  },
});
const thread = await store.createThread({
  title: "Retain settled patch",
  agentId: agent.id,
});
const append = store.appendEventOnceAtRunHead.bind(store);
store.appendEventOnceAtRunHead = async (input, options) => {
  if (
    (checkpoint === "before-effect" &&
      input.payload["executionEffectBoundary"] === true) ||
    (checkpoint === "after-effect" &&
      input.type === "tool.operation.settled") ||
    (checkpoint === "after-settlement" && input.type === "tool.completed")
  )
    process.exit(73);
  return append(input, options);
};
await new AgentRuntime(store, registry).runPrompt({
  threadId: thread.id,
  text: "Create retained.txt, then inspect it.",
  onEvent(event) {
    if (checkpoint === "after-terminal" && event.type === "tool.completed")
      process.exit(73);
  },
});
throw new Error("The crash checkpoint was not reached");
