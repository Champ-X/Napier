import { describe, expect, it } from "vitest";

import {
  AgentLifecyclePipelineHost,
  ComposableLifecycleExtensionPipeline,
  createAgentStepCapabilityView,
  type AgentStepLifecycleContext,
} from "../src/lifecycle-extension-pipeline.js";

function stepContext(): AgentStepLifecycleContext {
  return {
    kind: "step",
    runId: "run-1",
    threadId: "thread-1",
    stepIndex: 2,
    model: { provider: "faux", id: "faux-1" },
    capabilityView: createAgentStepCapabilityView({
      toolNames: ["read", "write"],
      schemaVersion: "tools-v1",
    }),
  };
}

describe("ComposableLifecycleExtensionPipeline", () => {
  it("keeps built-in safety outside deterministically ordered extensions", async () => {
    const pipeline =
      new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
    const phases: string[] = [];

    pipeline.use(
      {
        id: "test.late",
        order: 20,
        prepare: () => phases.push("prepare:late"),
        around: async (_context, next) => {
          phases.push("around:late:enter");
          const result = await next();
          phases.push("around:late:exit");
          return result;
        },
        finalize: () => phases.push("finalize:late"),
      },
      "plugin.zeta",
    );
    pipeline.use(
      {
        id: "test.early",
        order: -20,
        prepare: () => phases.push("prepare:early"),
        around: async (_context, next) => {
          phases.push("around:early:enter");
          const result = await next();
          phases.push("around:early:exit");
          return result;
        },
        finalize: () => phases.push("finalize:early"),
      },
      "plugin.alpha",
    );
    pipeline.installSafety(
      {
        id: "napier.safety.boundary",
        order: 10_000,
        prepare: () => phases.push("prepare:safety"),
        around: async (_context, next) => {
          phases.push("around:safety:enter");
          const result = await next();
          phases.push("around:safety:exit");
          return result;
        },
        finalize: () => phases.push("finalize:safety"),
      },
      "kernel.safety",
    );

    await expect(
      pipeline.execute(stepContext(), async () => {
        phases.push("operation");
        return "done";
      }),
    ).resolves.toBe("done");
    expect(phases).toEqual([
      "prepare:safety",
      "prepare:early",
      "prepare:late",
      "around:safety:enter",
      "around:early:enter",
      "around:late:enter",
      "operation",
      "around:late:exit",
      "around:early:exit",
      "around:safety:exit",
      "finalize:late",
      "finalize:early",
      "finalize:safety",
    ]);
    expect(
      pipeline.inspect().map(({ id, boundary }) => [id, boundary]),
    ).toEqual([
      ["napier.safety.boundary", "built_in_safety"],
      ["test.early", "external"],
      ["test.late", "external"],
    ]);
  });

  it("rejects an around extension that invokes next more than once", async () => {
    const pipeline =
      new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
    let operations = 0;
    pipeline.use({
      id: "test.double-next",
      around: async (_context, next) => {
        await next();
        return next();
      },
    });

    await expect(
      pipeline.execute(stepContext(), async () => {
        operations += 1;
        return "done";
      }),
    ).rejects.toThrow(
      "Lifecycle extension invoked next() more than once: test.double-next",
    );
    expect(operations).toBe(1);
  });

  it("prevents external around handlers from bypassing or replacing work", async () => {
    const bypass =
      new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
    bypass.use({
      id: "test.bypass",
      around: async () => ({ forged: true }),
    });
    await expect(
      bypass.execute(stepContext(), async () => ({ forged: false })),
    ).rejects.toThrow(
      "External lifecycle extension must invoke next(): test.bypass",
    );

    const replace =
      new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
    replace.use({
      id: "test.replace",
      around: async (_context, next) => {
        await next();
        return { forged: true };
      },
    });
    await expect(
      replace.execute(stepContext(), async () => ({ forged: false })),
    ).rejects.toThrow(
      "External lifecycle extension cannot replace a downstream result: test.replace",
    );
  });

  it("runs finalizers after failures and preserves all failure evidence", async () => {
    const pipeline =
      new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
    const phases: string[] = [];
    pipeline.use({
      id: "test.finalizer",
      prepare: () => phases.push("prepare"),
      finalize: () => {
        phases.push("finalize");
        throw new Error("finalization failed");
      },
    });

    const failure = await pipeline
      .execute(stepContext(), async () => {
        phases.push("operation");
        throw new Error("operation failed");
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "operation failed" }),
      expect.objectContaining({ message: "finalization failed" }),
    ]);
    expect(phases).toEqual(["prepare", "operation", "finalize"]);
  });

  it("supports reversible registration and owner disposal without stale handlers", async () => {
    const pipeline =
      new ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>();
    const calls: string[] = [];
    const effect = pipeline.use(
      {
        id: "test.first",
        prepare: () => calls.push("first"),
        dispose: () => calls.push("dispose:first"),
      },
      "plugin.fixture",
    );
    pipeline.use(
      {
        id: "test.second",
        prepare: () => calls.push("second"),
        dispose: () => calls.push("dispose:second"),
      },
      "plugin.fixture",
    );

    await effect.dispose();
    await effect.dispose();
    await pipeline.execute(stepContext(), async () => "done");
    await pipeline.disposeOwner("plugin.fixture");
    await pipeline.execute(stepContext(), async () => "done");

    expect(calls).toEqual(["dispose:first", "second", "dispose:second"]);
    expect(pipeline.inspect()).toEqual([]);
  });

  it("allows capability narrowing but rejects capability expansion", () => {
    const capabilityView = stepContext().capabilityView;
    expect(capabilityView.activeToolNames()).toEqual(["read", "write"]);
    capabilityView.restrictTo(["read"]);
    expect(capabilityView.activeToolNames()).toEqual(["read"]);
    expect(() => capabilityView.restrictTo(["write"])).toThrow(
      "Lifecycle extension cannot activate an unavailable capability: write",
    );
  });
});

describe("AgentLifecyclePipelineHost", () => {
  it("owns typed Step, Tool, and Completion pipelines", async () => {
    const host = new AgentLifecyclePipelineHost();
    const kinds: string[] = [];
    host.step.use({
      id: "test.step",
      prepare: (context) => kinds.push(context.kind),
    });
    host.tool.use({
      id: "test.tool",
      prepare: (context) =>
        kinds.push(`${context.kind}:${context.toolCall.name}`),
    });
    host.completion.use({
      id: "test.completion",
      prepare: (context) => kinds.push(`${context.kind}:${context.status}`),
    });

    await host.step.execute(stepContext(), async () => undefined);
    await host.tool.execute(
      {
        kind: "tool",
        runId: "run-1",
        threadId: "thread-1",
        stepIndex: 2,
        toolCall: { id: "call-1", name: "read" },
        input: { path: "README.md" },
      },
      async () => undefined,
    );
    await host.completion.execute(
      {
        kind: "completion",
        runId: "run-1",
        threadId: "thread-1",
        status: "completed",
      },
      async () => undefined,
    );

    expect(kinds).toEqual(["step", "tool:read", "completion:completed"]);
    expect(host.inspect()).toMatchObject({
      step: [{ id: "test.step" }],
      tool: [{ id: "test.tool" }],
      completion: [{ id: "test.completion" }],
    });
    await host.shutdown();
    await expect(
      host.step.execute(stepContext(), async () => undefined),
    ).rejects.toThrow("Lifecycle extension pipeline is closed");
  });
});
