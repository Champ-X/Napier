import { createHash } from "node:crypto";

const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Exercise real user steering and interruption through caller-supplied Runtime
 * APIs. This observer never fabricates tool results, edits the workspace or
 * supplies an answer/grader to the Agent. Keep its receipt outside the workspace.
 */
export function createHarnessScenarioController({
  threadId,
  runId,
  steps,
  queueMessage,
  beforeInterrupt,
  interrupt,
}) {
  const plan = structuredClone(steps);
  validatePlan(plan);
  let index = 0;
  let tail = Promise.resolve();
  let failure;
  const receipts = [];
  const controls = new Map();
  let lastTriggerSeq = -1;

  async function consume(event) {
    if (failure || index >= plan.length) return;
    if (event.threadId !== threadId || event.runId !== runId) return;
    if (!Number.isSafeInteger(event.seq) || typeof event.id !== "string")
      throw new Error("Scenario event identity is invalid");
    const step = plan[index];
    if (event.seq <= lastTriggerSeq || !matches(event, step.after, controls))
      return;
    // One event advances at most one step. The next action must have a later
    // durable trigger, including when tool callbacks arrive concurrently.
    const receipt = {
      stepId: step.id,
      action: step.action,
      triggerEventId: event.id,
      triggerSeq: event.seq,
    };
    if (step.action === "steer" || step.action === "follow_up") {
      const message = await queueMessage({
        threadId,
        runId,
        mode: step.action === "steer" ? "steering" : "follow_up",
        text: step.text,
      });
      if (!message || typeof message.id !== "string")
        throw new Error("Scenario control message has no durable identity");
      controls.set(step.id, message.id);
      receipt.controlMessageId = message.id;
      receipt.messageSha256 = sha(step.text);
    } else if (step.action === "interrupt") {
      receipt.observation = await beforeInterrupt(event);
      await interrupt();
    }
    receipts.push(receipt);
    lastTriggerSeq = event.seq;
    index++;
  }

  return {
    // Runtime event sinks are best-effort. Capture errors inside the controller
    // so a swallowed observer exception can never count as scenario success.
    observe(event) {
      const observed = structuredClone(event);
      tail = tail
        .then(() => consume(observed))
        .catch((error) => {
          failure ??= sha(String(error));
        });
      return tail;
    },
    async result() {
      await tail;
      const content = {
        kind: "napier.harness-scenario-receipt",
        schemaVersion: 1,
        threadId,
        runId,
        planSha256: sha(JSON.stringify(plan)),
        completed: !failure && index === plan.length,
        completedSteps: index,
        expectedSteps: plan.length,
        receipts: structuredClone(receipts),
        ...(failure ? { failureSha256: failure } : {}),
      };
      return { ...content, contentSha256: sha(JSON.stringify(content)) };
    },
  };
}

function matches(event, trigger, controls) {
  if (event.type !== trigger.type) return false;
  const payload = event.payload ?? {};
  if (trigger.controlStep)
    return payload.controlMessageId === controls.get(trigger.controlStep);
  return (
    payload.toolName === trigger.tool &&
    (trigger.status === undefined || payload.details?.status === trigger.status)
  );
}

function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length < 1 || plan.length > 16)
    throw new Error("Scenario needs 1-16 steps");
  const seen = new Set();
  const controls = new Set();
  for (const step of plan) {
    const trigger = step?.after;
    if (
      !step ||
      typeof step.id !== "string" ||
      !/^[a-z][a-z0-9_-]{0,63}$/u.test(step.id) ||
      seen.has(step.id) ||
      !["observe", "steer", "follow_up", "interrupt"].includes(step.action) ||
      !trigger ||
      !(
        (trigger.type === "tool.completed" &&
          typeof trigger.tool === "string" &&
          trigger.tool.length > 0 &&
          trigger.controlStep === undefined &&
          (trigger.status === undefined ||
            typeof trigger.status === "string")) ||
        (trigger.type === "run.control.delivered" &&
          controls.has(trigger.controlStep) &&
          trigger.tool === undefined &&
          trigger.status === undefined)
      )
    )
      throw new Error("Invalid scenario step or trigger");
    if (["steer", "follow_up"].includes(step.action)) {
      if (
        typeof step.text !== "string" ||
        !step.text.trim() ||
        step.text.length > 8000
      )
        throw new Error("Scenario control text is missing or too long");
      controls.add(step.id);
    } else if (step.text !== undefined) {
      throw new Error("Only control-message steps accept text");
    }
    if (step.action === "interrupt" && step !== plan.at(-1))
      throw new Error("Interruption must be the last scenario step");
    seen.add(step.id);
  }
}
