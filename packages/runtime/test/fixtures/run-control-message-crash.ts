import { mkdir } from "node:fs/promises";
import path from "node:path";
import { LocalStore } from "../../src/store.js";

const root = process.argv[2];
if (!root) throw new Error("Fixture root required");
await mkdir(path.join(root, "workspace"), { recursive: true });
const store = new LocalStore({
  dataRoot: path.join(root, "state"),
  workspaceRoot: path.join(root, "workspace"),
});
await store.initialize();
const agent = store.listAgents()[0]!;
const thread = await store.createThread({
  title: "Crash after control persistence",
  agentId: agent.id,
});
const run = await store.createRun({
  threadId: thread.id,
  agentId: agent.id,
  model: { provider: "faux-control", id: "faux-1" },
});
await store.queueRunControlMessage({
  threadId: thread.id,
  runId: run.id,
  clientMessageId: "crash-before-response",
  mode: "follow_up",
  text: "Keep the saved instruction.",
});
// No graceful store close or response transmission.
process.exit(73);
