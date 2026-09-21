import { describe, expect, it } from "vitest";
import { createHarnessScenarioController } from "./harness-scenario-controller.mjs";

const steps = [
  {
    id: "revision",
    action: "steer",
    text: "Use the revised threshold.",
    after: {
      type: "tool.completed",
      tool: "verify_workspace",
      status: "passed",
    },
  },
  {
    id: "delivered",
    action: "observe",
    after: { type: "run.control.delivered", controlStep: "revision" },
  },
  {
    id: "interrupt",
    action: "interrupt",
    after: { type: "tool.completed", tool: "apply_patch" },
  },
];
function event(seq, type, payload, runId = "run_owned") {
  return {
    id: `event_${seq}`,
    seq,
    type,
    payload,
    runId,
    threadId: "thread_owned",
  };
}
function fixture(overrides = {}) {
  const calls = [];
  const controller = createHarnessScenarioController({
    threadId: "thread_owned",
    runId: "run_owned",
    steps,
    queueMessage: async (input) => {
      calls.push(input);
      return { id: "control_owned" };
    },
    beforeInterrupt: async () => {
      calls.push("captured");
      return { filesSha256: "snapshot" };
    },
    interrupt: async () => {
      calls.push("interrupted");
    },
    ...overrides,
  });
  return { controller, calls };
}
const verified = event(1, "tool.completed", {
  toolName: "verify_workspace",
  details: { status: "passed" },
});
const delivered = event(3, "run.control.delivered", {
  controlMessageId: "control_owned",
});
const edited = event(4, "tool.completed", { toolName: "apply_patch" });

describe("real Runtime scenario orchestration", () => {
  it("waits for exact delivery before interrupting a later completed edit", async () => {
    const { controller, calls } = fixture();
    await controller.observe({ ...verified, runId: "run_foreign" });
    await controller.observe(
      event(0, "tool.completed", {
        toolName: "verify_workspace",
        details: { status: "failed" },
      }),
    );
    expect(calls).toEqual([]);
    await controller.observe(verified);
    await controller.observe(
      event(2, "tool.completed", { toolName: "apply_patch" }),
    );
    await controller.observe({
      ...delivered,
      payload: { controlMessageId: "control_foreign" },
    });
    expect((await controller.result()).completedSteps).toBe(1);
    await controller.observe(delivered);
    await controller.observe(edited);
    expect(calls.slice(1)).toEqual(["captured", "interrupted"]);
    expect(await controller.result()).toMatchObject({
      completed: true,
      completedSteps: 3,
    });
  });

  it("serializes concurrent callbacks and does not repeat a trigger", async () => {
    const { controller, calls } = fixture();
    await Promise.all([
      controller.observe(verified),
      controller.observe(verified),
      controller.observe(delivered),
      controller.observe(edited),
    ]);
    expect(calls).toHaveLength(3);
    expect(
      (await controller.result()).receipts.map((r) => r.triggerSeq),
    ).toEqual([1, 3, 4]);
  });

  it.each(["queue", "capture"])(
    "retains %s failures despite best-effort event delivery",
    async (failure) => {
      const { controller, calls } = fixture(
        failure === "queue"
          ? {
              queueMessage: async () => {
                throw new Error("private diagnostic");
              },
            }
          : {
              beforeInterrupt: async () => {
                throw new Error("private diagnostic");
              },
            },
      );
      await controller.observe(verified);
      await controller.observe(delivered);
      await controller.observe(edited);
      const receipt = await controller.result();
      expect(receipt.completed).toBe(false);
      expect(receipt.failureSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(receipt)).not.toContain("private diagnostic");
      expect(calls).not.toContain("interrupted");
    },
  );

  it("does not claim that an unobserved step completed or allow caller mutation", async () => {
    const input = structuredClone(steps);
    const { controller } = fixture({ steps: input });
    input.splice(0);
    await controller.observe(verified);
    const result = await controller.result();
    expect(result).toMatchObject({
      completed: false,
      completedSteps: 1,
      expectedSteps: 3,
    });
    result.receipts.splice(0);
    expect((await controller.result()).receipts).toHaveLength(1);
  });

  it("rejects a forward delivery reference or work after interruption", () => {
    expect(() => fixture({ steps: [steps[1]] })).toThrow("trigger");
    expect(() => fixture({ steps: [steps[2], steps[0]] })).toThrow("last");
  });
});
