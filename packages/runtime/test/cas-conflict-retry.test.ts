import { describe, expect, it, vi } from "vitest";

import {
  CasConflictRetryExhaustedError,
  retryCasConflict,
} from "../src/cas-conflict-retry.js";

class FixtureConflict extends Error {}

describe("CAS conflict retry", () => {
  it("backs off between classified conflicts and eventually returns", async () => {
    const waits: number[] = [];
    let executions = 0;

    const result = await retryCasConflict({
      operation: async () => {
        executions += 1;
        if (executions < 4) throw new FixtureConflict();
        return "won";
      },
      isConflict: (error) => error instanceof FixtureConflict,
      exhaustedMessage: "fixture was contended",
      options: {
        initialDelayMs: 4,
        maxDelayMs: 10,
        maxTotalDelayMs: 30,
        jitterRatio: 0,
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
        random: () => 0.5,
      },
    });

    expect(result).toBe("won");
    expect(executions).toBe(4);
    expect(waits).toEqual([4, 8, 10]);
  });

  it("rethrows non-conflicts unchanged without waiting", async () => {
    const semanticError = new Error("semantic invariant failed");
    const wait = vi.fn(async () => undefined);

    await expect(
      retryCasConflict({
        operation: async () => {
          throw semanticError;
        },
        isConflict: (error) => error instanceof FixtureConflict,
        exhaustedMessage: "fixture was contended",
        options: { wait },
      }),
    ).rejects.toBe(semanticError);
    expect(wait).not.toHaveBeenCalled();
  });

  it("fails closed after bounded attempts and retains the last conflict", async () => {
    const conflicts = Array.from(
      { length: 3 },
      (_, index) => new FixtureConflict(`conflict-${String(index + 1)}`),
    );
    const waits: number[] = [];
    let executions = 0;

    const failure = await retryCasConflict({
      operation: async () => {
        const conflict = conflicts[executions]!;
        executions += 1;
        throw conflict;
      },
      isConflict: (error) => error instanceof FixtureConflict,
      exhaustedMessage: "fixture was contended",
      options: {
        maxAttempts: 3,
        initialDelayMs: 4,
        maxDelayMs: 8,
        maxTotalDelayMs: 12,
        jitterRatio: 0,
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CasConflictRetryExhaustedError);
    expect(failure).toMatchObject({ attempts: 3, cause: conflicts[2] });
    expect(executions).toBe(3);
    expect(waits).toEqual([4, 8]);
  });

  it("honors cancellation while an injected wait is yielding", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancelled by fixture");
    let executions = 0;

    await expect(
      retryCasConflict({
        operation: async () => {
          executions += 1;
          throw new FixtureConflict();
        },
        isConflict: (error) => error instanceof FixtureConflict,
        exhaustedMessage: "fixture was contended",
        options: {
          signal: controller.signal,
          wait: async (_delayMs, signal) => {
            controller.abort(cancellation);
            signal?.throwIfAborted();
          },
          random: () => 0.5,
        },
      }),
    ).rejects.toBe(cancellation);
    expect(executions).toBe(1);
  });

  it("uses injected random values for deterministic bounded jitter", async () => {
    const waits: number[] = [];
    let executions = 0;

    await retryCasConflict({
      operation: async () => {
        executions += 1;
        if (executions < 3) throw new FixtureConflict();
      },
      isConflict: (error) => error instanceof FixtureConflict,
      exhaustedMessage: "fixture was contended",
      options: {
        initialDelayMs: 10,
        maxDelayMs: 30,
        jitterRatio: 0.5,
        random: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1),
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      },
    });

    expect(waits).toEqual([5, 30]);
  });
});
