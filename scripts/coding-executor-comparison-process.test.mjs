import { describe, expect, it } from "vitest";

import {
  normalizeOmpUsage,
  runComparisonProcess,
} from "./coding-executor-comparison-process.mjs";

describe("coding executor comparison process support", () => {
  it("normalizes nested OMP token and cost metrics", () => {
    expect(
      normalizeOmpUsage(
        JSON.stringify({
          result: {
            usage: {
              input_tokens: 123,
              output_tokens: 45,
              cost_usd: 0.0012,
            },
          },
        }),
      ),
    ).toEqual({
      inputTokens: 123,
      outputTokens: 45,
      costUsd: 0.0012,
    });
    expect(
      normalizeOmpUsage(
        `log line\n${JSON.stringify({ usage: { promptTokens: 10, completionTokens: 2 } })}`,
      ),
    ).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  it("runs a bounded child without shell interpolation", async () => {
    const result = await runComparisonProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({ok:true}))"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      timeoutMs: 5_000,
    });

    expect(result).toEqual(
      expect.objectContaining({
        code: 0,
        stdout: '{"ok":true}',
        stderr: "",
        durationMs: expect.any(Number),
      }),
    );
  });
});
