export async function measureLongThreadPerformance(input) {
  const rounds = [];
  for (let iteration = 1; iteration <= input.iterations; iteration += 1) {
    input.signal?.throwIfAborted();
    const agent = input.store.listAgents()[0];
    if (!agent) {
      throw new Error("Performance benchmark requires the seeded Agent");
    }
    const thread = await input.store.createThread({
      title: `Product performance benchmark ${String(iteration)}`,
      agentId: agent.id,
    });
    const run = await input.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const appendDurations = [];
    const batchStartedAt = performance.now();
    for (let index = 0; index < input.eventCount; index += 1) {
      input.signal?.throwIfAborted();
      const appendStartedAt = performance.now();
      await input.store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "model.text.delta",
        category: "model",
        visibility: "hidden",
        payload: {
          chunkCount: 1,
          deltaBytes: 128,
          delta: "x".repeat(128),
        },
      });
      appendDurations.push(round(performance.now() - appendStartedAt));
    }
    const batchDurationMs = round(performance.now() - batchStartedAt);
    await input.store.finishRun(run.id, "completed");
    const projectionStartedAt = performance.now();
    const detail = await input.store.getDetail(thread.id);
    const projectionMs = round(performance.now() - projectionStartedAt);
    if (detail.events.length !== input.eventCount) {
      throw new Error("Performance long-Thread projection is incomplete");
    }
    rounds.push({
      iteration,
      eventCount: detail.events.length,
      batchDurationMs,
      appendP50Ms: percentile(appendDurations, 0.5),
      appendP95Ms: percentile(appendDurations, 0.95),
      projectionMs,
      detailBytes: Buffer.byteLength(JSON.stringify(detail), "utf8"),
      eventBytes: Buffer.byteLength(JSON.stringify(detail.events), "utf8"),
    });
    input.onRound?.(rounds.at(-1));
  }
  return createLongThreadPerformanceMeasurement(rounds);
}

export function createLongThreadPerformanceMeasurement(inputRounds) {
  const rounds = inputRounds.map((input, index) => {
    const roundValue = exactRecord(
      input,
      [
        "iteration",
        "eventCount",
        "batchDurationMs",
        "appendP50Ms",
        "appendP95Ms",
        "projectionMs",
        "detailBytes",
        "eventBytes",
      ],
      "Long-Thread performance round",
    );
    if (roundValue.iteration !== index + 1) {
      throw new Error("Long-Thread performance iteration is invalid");
    }
    integerInRange(roundValue.eventCount, 1, 10_000, "Long-Thread eventCount");
    for (const name of [
      "batchDurationMs",
      "appendP50Ms",
      "appendP95Ms",
      "projectionMs",
      "detailBytes",
      "eventBytes",
    ]) {
      nonNegativeNumber(roundValue[name], `Long-Thread performance ${name}`);
    }
    if (roundValue.appendP50Ms > roundValue.appendP95Ms) {
      throw new Error("Long-Thread append percentile order is invalid");
    }
    return structuredClone(roundValue);
  });
  if (rounds.length < 1) {
    throw new Error("Long-Thread performance rounds are empty");
  }
  const eventCount = rounds[0].eventCount;
  if (rounds.some((roundValue) => roundValue.eventCount !== eventCount)) {
    throw new Error("Long-Thread performance event counts differ");
  }
  return {
    roundCount: rounds.length,
    eventCount,
    totalEventCount: eventCount * rounds.length,
    rounds,
    batchDurationMedianMs: median(
      rounds.map((roundValue) => roundValue.batchDurationMs),
    ),
    appendP50MedianMs: median(
      rounds.map((roundValue) => roundValue.appendP50Ms),
    ),
    appendP95MedianMs: median(
      rounds.map((roundValue) => roundValue.appendP95Ms),
    ),
    projectionMedianMs: median(
      rounds.map((roundValue) => roundValue.projectionMs),
    ),
    detailBytesMedian: median(
      rounds.map((roundValue) => roundValue.detailBytes),
    ),
    eventBytesMedian: median(rounds.map((roundValue) => roundValue.eventBytes)),
  };
}

export function validateLongThreadPerformanceMeasurement(input, sample) {
  const value = exactRecord(
    input,
    [
      "roundCount",
      "eventCount",
      "totalEventCount",
      "rounds",
      "batchDurationMedianMs",
      "appendP50MedianMs",
      "appendP95MedianMs",
      "projectionMedianMs",
      "detailBytesMedian",
      "eventBytesMedian",
    ],
    "Long-Thread performance measurements",
  );
  if (!Array.isArray(value.rounds)) {
    throw new Error("Long-Thread performance rounds are invalid");
  }
  const expected = createLongThreadPerformanceMeasurement(value.rounds);
  if (
    expected.roundCount !== sample.longThreadIterations ||
    expected.eventCount !== sample.longThreadEventCount
  ) {
    throw new Error("Long-Thread performance sample count is invalid");
  }
  if (stableJson(value) !== stableJson(expected)) {
    throw new Error("Long-Thread performance aggregate is invalid");
  }
  return expected;
}

function median(values) {
  return percentile(values, 0.5);
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return round(sorted[index]);
}

function integerInRange(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
}

function nonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function exactRecord(input, keys, label) {
  if (!isRecord(input)) throw new Error(`${label} must be an object`);
  const actualKeys = Object.keys(input).sort();
  const expectedKeys = [...keys].sort();
  if (stableJson(actualKeys) !== stableJson(expectedKeys)) {
    throw new Error(`${label} has unexpected fields`);
  }
  return input;
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}
