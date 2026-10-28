import { UnsupportedSandboxAdapter } from "../../src/unsupported-sandbox.js";
import { writeFile } from "node:fs/promises";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../../src/agent-runtime.js";
import { ModelRegistry } from "../../src/models.js";
import { LocalStore } from "../../src/store.js";

const [root, checkpoint = "complete"] = process.argv.slice(2);
if (!root) throw new Error("Fixture root missing");
const store = new LocalStore({
  workspaceRoot: path.join(root, "workspace"),
  dataRoot: path.join(root, "data"),
});
const restartStart = performance.now();
await store.initialize(true);
const restartMs = performance.now() - restartStart;
await new Promise((resolve) => setTimeout(resolve, 2100));
const sweep = await store.claimAutomaticRecoveries("patch-resume-fixture");
const claim = sweep.claims[0];
if (!claim)
  throw new Error(`Recovery claim unavailable: ${JSON.stringify(sweep)}`);
const provider = fauxProvider({ provider: "faux-patch-recovery" });
let toolNames: string[] = [],
  promptHasEvidence = false;
provider.setResponses([
  (context) => {
    toolNames = context.tools?.map((tool) => tool.name) ?? [];
    promptHasEvidence = JSON.stringify(context.messages).includes(
      "exact pending patch operation(s)",
    );
    return fauxAssistantMessage("Continue the remaining read-only work.");
  },
]);
const registry = new ModelRegistry();
registry.registerProvider(provider.provider);
let recoveryStarted = 0;
function crashNow(): never {
  fs.writeFileSync(
    path.join(root!, "recovery-process-observation.json"),
    JSON.stringify({
      checkpoint,
      restartMs,
      resumeMs: performance.now() - recoveryStarted,
      modelCalls: provider.state.callCount,
    }),
  );
  process.exit(73);
}
const append = store.appendEventOnceAtRunHead.bind(store);
store.appendEventOnceAtRunHead = async (input, options) => {
  if (checkpoint === "after-settlement" && input.type === "tool.completed")
    crashNow();
  const result = await append(input, options);
  if (
    (checkpoint === "after-prepared" &&
      input.type === "workspace.patch.prepared") ||
    (checkpoint === "after-terminal" && input.type === "tool.completed")
  )
    crashNow();
  return result;
};
if (checkpoint === "after-file") {
  const link = fs.promises.link,
    rename = fs.promises.rename;
  fs.promises.link = async (...args) => {
    await link(...args);
    if (String(args[1]).endsWith("/retained.txt")) crashNow();
  };
  fs.promises.rename = async (...args) => {
    await rename(...args);
    if (String(args[1]).endsWith("/retained.txt")) crashNow();
  };
  syncBuiltinESMExports();
}
recoveryStarted = performance.now();
const run = await new AgentRuntime(
  store,
  registry,
  undefined,
  checkpoint === "sandbox"
    ? new UnsupportedSandboxAdapter("recovery-test")
    : undefined,
).resumeInterruptedRunAutomatically({
  ...claim,
  onRunCreated: async (run) => {
    await store.bindAutomaticRecoveryRun(claim.attempt.id, claim.token, run.id);
    if (checkpoint === "after-created") crashNow();
    if (checkpoint === "permissions")
      await store.updateAgent(run.agentId, { toolPolicy: "observe" });
    if (checkpoint === "target")
      await writeFile(path.join(root, "workspace/retained.txt"), "external\n");
  },
});
if (checkpoint === "after-return") crashNow();
await writeFile(
  path.join(root, "recovery-process-observation.json"),
  JSON.stringify({
    checkpoint,
    restartMs,
    resumeMs: performance.now() - recoveryStarted,
    modelCalls: provider.state.callCount,
  }),
);
await store.settleAutomaticRecoveryAttempt(
  claim.attempt.id,
  claim.token,
  run.id,
);
await writeFile(
  path.join(root, "recovery-result.json"),
  JSON.stringify({
    run,
    toolNames,
    promptHasEvidence,
    modelCalls: provider.state.callCount,
  }),
);
store.close();

process.exit(0);
