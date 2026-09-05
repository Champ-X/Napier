import { describe, expect, it } from "vitest";

import {
  ToolConcurrencyEscalationError,
  ToolConcurrencyGate,
  ToolConcurrencyLeaseAbortedError,
  ToolConcurrencyStaleLeaseError,
  type ToolConcurrencyResourceRequirement,
} from "../src/tool-concurrency-gate.js";

describe("ToolConcurrencyGate", () => {
  it("preserves the scalar API's safe, serialized, and exclusive semantics", async () => {
    const gate = new ToolConcurrencyGate();
    let activeSafe = 0;
    let maxSafe = 0;
    let activeSerialized = 0;
    let maxSerialized = 0;

    await Promise.all([
      gate.run("safe", undefined, async () => {
        activeSafe += 1;
        maxSafe = Math.max(maxSafe, activeSafe);
        await turn();
        activeSafe -= 1;
      }),
      gate.run("safe", undefined, async () => {
        activeSafe += 1;
        maxSafe = Math.max(maxSafe, activeSafe);
        await turn();
        activeSafe -= 1;
      }),
    ]);
    await Promise.all([
      gate.run("serialized", undefined, async () => {
        activeSerialized += 1;
        maxSerialized = Math.max(maxSerialized, activeSerialized);
        await turn();
        activeSerialized -= 1;
      }),
      gate.run("serialized", undefined, async () => {
        activeSerialized += 1;
        maxSerialized = Math.max(maxSerialized, activeSerialized);
        await turn();
        activeSerialized -= 1;
      }),
    ]);

    expect(maxSafe).toBe(2);
    expect(maxSerialized).toBe(1);
  });

  it("admits requirements all-or-none without head-of-line blocking unrelated resources", async () => {
    const gate = new ToolConcurrencyGate();
    const releaseA = deferred<void>();
    const holdingA = deferred<void>();
    const releaseAB = deferred<void>();
    const holdingAB = deferred<void>();
    const reachedC = deferred<void>();
    const reachedB = deferred<void>();

    const first = gate.runWithResources(
      "hold-a",
      [requirement("domain/a", "exclusive")],
      undefined,
      async () => {
        holdingA.resolve();
        await releaseA.promise;
      },
    );
    await holdingA.promise;
    const multiResource = gate.runWithResources(
      "claim-a-and-b",
      [
        requirement("domain/a", "serialized"),
        requirement("domain/b", "exclusive"),
      ],
      undefined,
      async () => {
        holdingAB.resolve();
        await releaseAB.promise;
      },
    );
    const unrelated = gate.runWithResources(
      "claim-c",
      [requirement("domain/c", "exclusive")],
      undefined,
      async () => reachedC.resolve(),
    );
    const laterB = gate.runWithResources(
      "claim-b-later",
      [requirement("domain/b", "safe")],
      undefined,
      async () => reachedB.resolve(),
    );

    await reachedC.promise;
    await turn();
    expect(holdingAB.settled()).toBe(false);
    expect(reachedB.settled()).toBe(false);

    releaseA.resolve();
    await holdingAB.promise;
    expect(reachedB.settled()).toBe(false);
    releaseAB.resolve();
    await Promise.all([first, multiResource, unrelated, laterB]);
    expect(reachedB.settled()).toBe(true);
  });

  it("lets an ancestor-covered child finish ahead of outside waiters", async () => {
    const gate = new ToolConcurrencyGate();
    const parentStarted = deferred<void>();
    const allowChild = deferred<void>();
    const phases: string[] = [];

    const parent = gate.runWithResources(
      "parent",
      [requirement("workspace", "serialized")],
      undefined,
      async () => {
        phases.push("parent:start");
        parentStarted.resolve();
        await allowChild.promise;
        await gate.runWithResources(
          "child",
          [requirement("workspace/file.ts", "serialized")],
          undefined,
          async () => phases.push("child"),
        );
        phases.push("parent:end");
      },
    );
    await parentStarted.promise;
    const outside = gate.runWithResources(
      "outside",
      [requirement("workspace/file.ts", "serialized")],
      undefined,
      async () => phases.push("outside"),
    );
    allowChild.resolve();
    await Promise.all([parent, outside]);

    expect(phases).toEqual([
      "parent:start",
      "child",
      "parent:end",
      "outside",
    ]);
  });

  it("serializes Promise.all siblings even when their ancestor covers the resource", async () => {
    const gate = new ToolConcurrencyGate();
    let active = 0;
    let maximum = 0;

    await gate.runWithResources(
      "parent",
      [requirement("workspace", "serialized")],
      undefined,
      async () => {
        await Promise.all(
          ["left", "right"].map((operationId) =>
            gate.runWithResources(
              operationId,
              [requirement("workspace/file.ts", "serialized")],
              undefined,
              async () => {
                active += 1;
                maximum = Math.max(maximum, active);
                await turn();
                active -= 1;
              },
            ),
          ),
        );
      },
    );

    expect(maximum).toBe(1);
  });

  it("allows a nested operation to coordinate an unrelated resource", async () => {
    const gate = new ToolConcurrencyGate();
    const result = await gate.runWithResources(
      "workspace-parent",
      [requirement("workspace", "serialized")],
      undefined,
      () =>
        gate.runWithResources(
          "browser-child",
          [requirement("browser/session-1", "exclusive")],
          undefined,
          async () => "completed",
        ),
    );

    expect(result).toBe("completed");
  });

  it("fails a same-domain strength upgrade with a typed error instead of deadlocking", async () => {
    const gate = new ToolConcurrencyGate();
    let childExecuted = false;

    await gate.runWithResources(
      "safe-parent",
      [requirement("workspace", "safe")],
      undefined,
      async () => {
        await expect(
          gate.runWithResources(
            "serialized-child",
            [requirement("workspace/file.ts", "serialized")],
            undefined,
            async () => {
              childExecuted = true;
            },
          ),
        ).rejects.toBeInstanceOf(ToolConcurrencyEscalationError);
      },
    );

    expect(childExecuted).toBe(false);
  });

  it("uses the strongest covering declaration for overlapping parent requirements", async () => {
    const gate = new ToolConcurrencyGate();
    await expect(
      gate.runWithResources(
        "parent",
        [
          requirement("workspace", "safe"),
          requirement("workspace/file.ts", "exclusive"),
        ],
        undefined,
        () =>
          gate.runWithResources(
            "child",
            [requirement("workspace/file.ts", "serialized")],
            undefined,
            async () => "covered",
          ),
      ),
    ).resolves.toBe("covered");
  });

  it("fails closed when a detached async context uses a released generation", async () => {
    const gate = new ToolConcurrencyGate();
    const trigger = deferred<void>();
    let detached!: Promise<void>;

    await gate.runWithResources(
      "parent",
      [requirement("workspace", "serialized")],
      undefined,
      async () => {
        detached = trigger.promise.then(() =>
          gate.runWithResources(
            "detached-child",
            [requirement("workspace/file.ts", "safe")],
            undefined,
            async () => undefined,
          ),
        );
      },
    );
    trigger.resolve();

    await expect(detached).rejects.toBeInstanceOf(
      ToolConcurrencyStaleLeaseError,
    );
  });

  it("drains a registered child if its parent scope closes while it is queued", async () => {
    const gate = new ToolConcurrencyGate();
    const releaseBlocker = deferred<void>();
    const blockerStarted = deferred<void>();
    const blocker = gate.runWithResources(
      "browser-blocker",
      [requirement("browser", "exclusive")],
      undefined,
      async () => {
        blockerStarted.resolve();
        await releaseBlocker.promise;
      },
    );
    await blockerStarted.promise;
    let childExecuted = false;
    let detachedChild!: Promise<void>;
    await gate.runWithResources(
      "workspace-parent",
      [requirement("workspace", "serialized")],
      undefined,
      async () => {
        detachedChild = gate.runWithResources(
          "queued-child",
          [requirement("browser", "exclusive")],
          undefined,
          async () => {
            childExecuted = true;
          },
        );
        await turn();
      },
    );

    await expect(detachedChild).rejects.toBeInstanceOf(
      ToolConcurrencyStaleLeaseError,
    );
    releaseBlocker.resolve();
    await blocker;
    expect(childExecuted).toBe(false);
  });

  it("rejects descendants of an aborted active lease and drains aborted waiters", async () => {
    const gate = new ToolConcurrencyGate();
    const controller = new AbortController();
    await gate.runWithResources(
      "abortable-parent",
      [requirement("workspace", "safe")],
      controller.signal,
      async () => {
        controller.abort(new Error("stop"));
        await expect(
          gate.runWithResources(
            "child-after-abort",
            [requirement("browser", "safe")],
            undefined,
            async () => undefined,
          ),
        ).rejects.toBeInstanceOf(ToolConcurrencyLeaseAbortedError);
      },
    );

    const hold = deferred<void>();
    const held = deferred<void>();
    const holdOperation = gate.runWithResources(
      "safe-holder",
      [requirement("network", "safe")],
      undefined,
      async () => {
        held.resolve();
        await hold.promise;
      },
    );
    await held.promise;
    const waitingController = new AbortController();
    const cancelled = gate.runWithResources(
      "exclusive-waiter",
      [requirement("network", "exclusive")],
      waitingController.signal,
      async () => undefined,
    );
    const laterSafeReached = deferred<void>();
    const laterSafe = gate.runWithResources(
      "later-safe",
      [requirement("network", "safe")],
      undefined,
      async () => laterSafeReached.resolve(),
    );
    await turn();
    expect(laterSafeReached.settled()).toBe(false);
    waitingController.abort(new Error("cancel waiter"));
    await expect(cancelled).rejects.toThrow("cancel waiter");
    await laterSafeReached.promise;
    hold.resolve();
    await Promise.all([holdOperation, laterSafe]);
  });

  it("supports the operation request overload", async () => {
    const gate = new ToolConcurrencyGate();
    await expect(
      gate.run(
        {
          operationId: "request-overload",
          requirements: [requirement(["browser", "session-1"], "safe")],
        },
        undefined,
        async () => 42,
      ),
    ).resolves.toBe(42);
  });
});

function requirement(
  key: string | readonly string[],
  mode: ToolConcurrencyResourceRequirement["mode"],
): ToolConcurrencyResourceRequirement {
  return { key, mode };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  let complete = false;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = (value) => {
      complete = true;
      promiseResolve(value);
    };
    reject = (reason) => {
      complete = true;
      promiseReject(reason);
    };
  });
  return { promise, resolve, reject, settled: () => complete };
}

async function turn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
