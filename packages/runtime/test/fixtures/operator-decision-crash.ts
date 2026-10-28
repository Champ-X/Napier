import { mkdir } from "node:fs/promises";
import path from "node:path";
import { LocalStore as CurrentStore } from "../../src/store.js";
import { SqliteLedger } from "../../src/sqlite-ledger.js";

const [root, checkpoint] = process.argv.slice(2);
if (!root) throw new Error("Fixture root required");
const modulePath = process.env["NAPIER_DECISION_STORE_MODULE"];
const LocalStore: typeof CurrentStore = modulePath
  ? (await import(modulePath)).LocalStore
  : CurrentStore;
await mkdir(path.join(root, "workspace"), { recursive: true });
const store = new LocalStore({
  dataRoot: path.join(root, "data"),
  workspaceRoot: path.join(root, "workspace"),
});
await store.initialize();
const agent = await store.updateAgent(store.listAgents()[0]!.id, {
  model: { provider: "faux-decision-recovery", id: "faux-1" },
  toolPolicy: "workspace",
  enabledTools: ["apply_patch"],
  enabledSubagents: [],
});
const thread = await store.createThread({
  title: "Saved answer",
  agentId: agent.id,
});
const origin = await store.createRun({
  threadId: thread.id,
  agentId: agent.id,
});
const requested = await store.requestOperatorDecision({
  threadId: thread.id,
  runId: origin.id,
  header: "Output",
  question: "Which output?",
  options: [
    { label: "File", description: "Create the agreed file." },
    { label: "Stop", description: "Keep the work paused." },
  ],
  multiSelect: false,
});
await store.finishRun(origin.id, "completed", {
  waitForOperatorDecisionId: requested.decision.id,
});
await store.answerOperatorDecision(thread.id, requested.decision.id, {
  selectedOptionIds: ["option_1"],
  customText: "Keep my saved answer.",
});
if (checkpoint === "after-answer") process.exit(73);
if (checkpoint === "answer-retry") {
  let error: string | undefined;
  try {
    await store.answerOperatorDecision(thread.id, requested.decision.id, {
      selectedOptionIds: ["option_1"],
      customText: "Keep my saved answer.",
    });
  } catch (caught) {
    error = String(caught);
  }
  process.stdout.write(JSON.stringify({ retryAccepted: !error, error }) + "\n");
  store.close();
  process.exit(0);
}

const commit = SqliteLedger.prototype.commit;
SqliteLedger.prototype.commit = function (revision, state, events) {
  if (events?.some((event) => event.type === "operator.decision.continued")) {
    if (checkpoint === "before-bind-commit") process.exit(73);
    const result = commit.call(this, revision, state, events);
    if (checkpoint === "after-bind-commit") process.exit(73);
    return result;
  }
  return commit.call(this, revision, state, events);
};
await store.createLeasedRun(
  {
    threadId: thread.id,
    agentId: agent.id,
    parentRunId: origin.id,
    operatorDecisionId: requested.decision.id,
  },
  { ownerId: "worker_decision_crash", ttlMs: 60000 },
);
if (checkpoint === "after-create") process.exit(73);
throw new Error("Crash checkpoint was not reached");
