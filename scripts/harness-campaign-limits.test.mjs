import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "vitest";
import { campaignLimitOverrides } from "./harness-campaign-limits.mjs";

test("legacy limits remain stable; a slow probe can lower spending without losing wait time", () => {
  assert.deepEqual(campaignLimitOverrides({}), {
    maxCostUsd: 3,
    timeoutMs: 240_000,
  });
  assert.deepEqual(
    campaignLimitOverrides({
      "max-cost-usd": "0.05",
      "run-timeout-ms": "900000",
    }),
    {
      maxCostUsd: 0.05,
      timeoutMs: 900_000,
    },
  );
});

test("invalid or increased spending limits fail closed", () => {
  for (const value of ["", " ", "0", "-1", "NaN", "Infinity", "3.01"])
    assert.throws(
      () => campaignLimitOverrides({ "max-cost-usd": value }),
      /max-cost-usd/,
    );
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "3600001"])
    assert.throws(
      () => campaignLimitOverrides({ "run-timeout-ms": value }),
      /run-timeout-ms/,
    );
});

test("both CLI entries reject bad limits before loading a runtime or credentials", () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/API_KEY|TOKEN|SECRET|LIVE|NODE_OPTIONS/iu.test(key),
    ),
  );
  for (const entry of ["campaign", "suite"])
    for (const [flag, value] of [
      ["max-cost-usd", "Infinity"],
      ["run-timeout-ms", "1.5"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [`scripts/run-harness-optimization-${entry}.mjs`, `--${flag}`, value],
        {
          env,
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(flag));
      assert.doesNotMatch(
        result.stderr,
        /credential is required|ERR_MODULE_NOT_FOUND/,
      );
    }
});
