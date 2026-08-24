import { writeFile } from "node:fs/promises";

import { Type } from "typebox";

import { captureToolInvocation } from "../packages/runtime/dist/tool-invocation-capture.js";
import { ToolInvocationCapsuleStore } from "../packages/runtime/dist/tool-invocation-capsule-store.js";
import { captureToolInvocationResult } from "../packages/runtime/dist/tool-invocation-result-capture.js";
import { ToolInvocationResultCapsuleStore } from "../packages/runtime/dist/tool-invocation-result-capsule-store.js";
import { createGovernedCodeBridgeDispatcher } from "../packages/runtime/dist/governed-code-bridge.js";
import { recordAgentToolPolicyBlock } from "../packages/runtime/dist/agent-tool-policy-preflight.js";
import { createWorkspaceTools } from "../packages/runtime/dist/tools.js";
import {
  addLedgerRun,
  createEvidenceStore,
  ledgerRun,
  reopenEvidenceStore,
} from "./agent-harness-acceptance-evidence-support.mjs";

const BRIDGE_EVENTS = new Set([
  "context.tool_invocation",
  "code_bridge.authorized",
  "tool.started",
  "context.tool_result",
  "tool.completed",
  "tool.failed",
  "tool.blocked",
]);

export async function collectCodeBridgeEvidence(root, ledgerRuns) {
  let fixture = await createEvidenceStore(root, "code-bridge");
  await writeFile(
    `${fixture.workspaceRoot}/evidence.txt`,
    "CODE_BRIDGE_EVIDENCE\n",
  );
  const tools = createWorkspaceTools(fixture.workspaceRoot);
  const readTool = tools.find((tool) => tool.name === "read_file");
  if (!readTool) throw new Error("Code Bridge read tool is unavailable");
  const invocationCapsules = new ToolInvocationCapsuleStore(fixture.dataRoot);
  const resultCapsules = new ToolInvocationResultCapsuleStore(fixture.dataRoot);
  const records = [];
  for (let index = 0; index < 100; index += 1) {
    const owner = await createOwner(
      fixture.store,
      `Code Bridge ${String(index + 1)}`,
    );
    const callId = `codebridge_kernelrequest_${String(index).padStart(20, "0")}_1`;
    const dispatch = createGovernedCodeBridgeDispatcher({
      store: fixture.store,
      run: owner.run,
      tools: [readTool],
      activeToolNames: () => new Set([readTool.name]),
      assertBudget: () => undefined,
      preflight: async (toolCall, args) => {
        const receipt = await captureToolInvocation(
          fixture.store,
          invocationCapsules,
          owner.run,
          readTool,
          toolCall.id,
          toolCall.name,
          args,
        );
        owner.invocation = receipt;
        return undefined;
      },
      finalize: async ({ toolCall, result, isError }) => {
        await captureToolInvocationResult(
          fixture.store,
          resultCapsules,
          owner.run,
          owner.invocation,
          result,
          isError,
        );
        return undefined;
      },
    });
    await dispatch({
      evaluationId: `kernelrequest_${String(index).padStart(20, "0")}`,
      callId: 1,
      toolId: "read_file",
      input: { path: "evidence.txt" },
    });
    await fixture.store.finishRun(owner.run.id, "completed", {
      outcome: "completed",
    });
    records.push({
      id: `bridge_${String(index + 1)}`,
      callId,
      threadId: owner.thread.id,
      runId: owner.run.id,
    });
  }
  const probes = [];
  for (const probeClass of [
    "workspace_escape",
    "inactive_capability",
    "unknown_effect",
  ]) {
    probes.push(await runPrivilegeProbe(fixture.store, readTool, probeClass));
  }
  fixture = await reopenEvidenceStore(fixture);
  try {
    const codeBridgeCalls = await Promise.all(
      records.map(async ({ threadId, runId, ...item }) => ({
        ...item,
        runEvidenceSha256: addLedgerRun(
          ledgerRuns,
          await ledgerRun(fixture.store, threadId, runId, BRIDGE_EVENTS),
        ),
      })),
    );
    const codeBridgePrivilegeProbes = await Promise.all(
      probes.map(async ({ threadId, runId, ...item }) => ({
        ...item,
        runEvidenceSha256: addLedgerRun(
          ledgerRuns,
          await ledgerRun(fixture.store, threadId, runId, BRIDGE_EVENTS),
        ),
      })),
    );
    return { codeBridgeCalls, codeBridgePrivilegeProbes };
  } finally {
    await fixture.store.shutdown();
  }
}

async function runPrivilegeProbe(store, readTool, probeClass) {
  const owner = await createOwner(store, `Code Bridge probe ${probeClass}`);
  const evaluationId = `kernelrequest_probe_${probeClass.padEnd(20, "x")}`;
  const callId = `codebridge_${evaluationId}_1`;
  let tools = [readTool];
  let active = new Set([readTool.name]);
  let input = { path: "../outside.txt" };
  if (probeClass === "inactive_capability") active = new Set();
  if (probeClass === "unknown_effect") {
    tools = [unknownEffectTool()];
    active = new Set(["unknown_effect_tool"]);
    input = {};
  }
  const dispatch = createGovernedCodeBridgeDispatcher({
    store,
    run: owner.run,
    tools,
    activeToolNames: () => active,
    assertBudget: () => undefined,
    preflight: async (toolCall, args) => {
      if (probeClass !== "workspace_escape") return undefined;
      return recordAgentToolPolicyBlock(
        { store, run: owner.run, toolCall, args },
        "path escapes the configured workspace",
        "safety_block",
      );
    },
    finalize: async () => undefined,
  });
  await dispatch({
    evaluationId,
    callId: 1,
    toolId:
      probeClass === "unknown_effect" ? "unknown_effect_tool" : "read_file",
    input,
  }).catch(() => undefined);
  await store.finishRun(owner.run.id, "completed", { outcome: "completed" });
  return {
    id: `bridge_probe_${probeClass}`,
    probeClass,
    callId,
    threadId: owner.thread.id,
    runId: owner.run.id,
  };
}

async function createOwner(store, title) {
  const agent = store.listAgents()[0];
  const thread = await store.createThread({ title, agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  return { thread, run, invocation: undefined };
}

function unknownEffectTool() {
  return {
    name: "unknown_effect_tool",
    label: "Unknown effect",
    description: "Never executes inside Code Bridge.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      throw new Error("Unknown-effect tool must not execute");
    },
  };
}
