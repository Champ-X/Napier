import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function readRunStreamSources(): Promise<{
  execution: string;
  stream: string;
}> {
  const [execution, stream] = await Promise.all([
    readFile(
      new URL("../src/thread-execution-http.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../packages/runtime/src/run-stream.ts", import.meta.url),
      "utf8",
    ),
  ]);
  return { execution, stream };
}

describe("Thread execution HTTP guards", () => {
  it("centralizes all Run SSE routes behind terminal status evidence", async () => {
    const { execution, stream } = await readRunStreamSources();
    expect(
      execution.match(/type:\s*"done"[\s\S]{0,120}status:\s*run\.status/g),
    ).toBeNull();
    expect(
      execution.match(
        /streamRunDoneFrame\(\s*threadId,\s*run\.id,\s*run\.status,\s*snapshotFrame\.detailSha256,\s*snapshotFrame\.detailBytes,\s*snapshotFrame\.detail\.thread\.eventCount,\s*snapshotFrame\.eventBytes,\s*hashEventStream\(snapshotFrame\.detail\.events\),?\s*\)/g,
      ),
    ).toHaveLength(1);
    expect(execution.match(/streamAgentRun\(/g)).toHaveLength(4);
    expect(stream).toContain("threadId,");
    expect(stream).toContain("snapshotSha256,");
    expect(stream).toContain("snapshotBytes,");
    expect(stream).toContain("eventCount,");
    expect(stream).toContain("eventBytes,");
    expect(stream).toContain("eventStreamSha256,");
    expect(stream).toMatch(
      /case "queued":[\s\S]*case "running":[\s\S]*throw new Error/,
    );
    expect(stream).toContain(
      "Run stream cannot finish with non-terminal status",
    );
  });

  it("keeps snapshot frames behind detail hashes and before done", async () => {
    const { execution, stream } = await readRunStreamSources();
    expect(
      execution.match(/type:\s*"snapshot"[\s\S]{0,120}detail:/g),
    ).toBeNull();
    expect(
      execution.match(
        /const snapshotFrame = streamSnapshotFrame\(\s*await services\.store\.getDetail\(threadId\),\s*\)/g,
      ),
    ).toHaveLength(1);
    expect(
      execution.match(
        /const snapshotFrame = streamSnapshotFrame\([\s\S]{0,160}const doneFrame = streamRunDoneFrame\(\s*threadId,\s*run\.id,\s*run\.status,\s*snapshotFrame\.detailSha256,\s*snapshotFrame\.detailBytes,\s*snapshotFrame\.detail\.thread\.eventCount,\s*snapshotFrame\.eventBytes,\s*hashEventStream\(snapshotFrame\.detail\.events\),?\s*\);[\s\S]{0,80}await writeFrame\(snapshotFrame\);[\s\S]{0,80}await writeFrame\(doneFrame\);/g,
      ),
    ).toHaveLength(1);
    expect(stream).toContain("const serializedDetail = JSON.stringify(detail)");
    expect(stream).toContain("detailSha256: sha256(serializedDetail)");
    expect(stream).toContain(
      'detailBytes: Buffer.byteLength(serializedDetail, "utf8")',
    );
    expect(stream).toContain("eventBytes: jsonByteLength(detail.events)");
  });

  it("keeps event and error frames behind hash guards", async () => {
    const { execution, stream } = await readRunStreamSources();
    expect(
      execution.match(/writeFrame\(\s*\{\s*type:\s*"event"[\s\S]{0,120}event/g),
    ).toBeNull();
    expect(execution.match(/writeFrame\(\s*\{\s*type:\s*"error"/g)).toBeNull();
    expect(
      execution.match(
        /writeFrame\(\s*streamEventFrame\(event\),\s*String\(event\.seq\)\s*\)/g,
      ),
    ).toHaveLength(1);
    expect(
      execution.match(
        /writeFrame\(\s*streamRunErrorFrame\(threadId,\s*error\)\s*\)/g,
      ),
    ).toHaveLength(1);
    expect(stream).toContain("eventSha256: sha256(JSON.stringify(event))");
    expect(stream).toContain("diagnosticSha256: sha256(errorMessage(error))");
  });
});
