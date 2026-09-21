import assert from "node:assert/strict";
import { test } from "vitest";
import { hostAwakeEvidence, requireHostAwake } from "./harness-host-awake.mjs";
const line = (state, detail = "system event") =>
  `2026-09-15 06:08:29 +0800 ${state} \t${detail}`;

test("a full wake admits work; later maintenance wake or sleep refuses it", () => {
  const awake = hostAwakeEvidence("darwin", line("Wake"), 0);
  assert.equal(awake.reason, "full_wake");
  assert.doesNotThrow(() => requireHostAwake(awake));
  for (const state of ["Sleep", "DarkWake"]) {
    const evidence = hostAwakeEvidence(
      "darwin",
      `${line("Wake")}\n${line(state)}`,
      0,
    );
    assert.equal(evidence.lastTransition.state, state);
    assert.equal(evidence.eligible, false);
    assert.throws(
      () => requireHostAwake(evidence),
      /No provider request was sent/,
    );
  }
});

test("wake requests and driver acknowledgments cannot masquerade as a full wake", () => {
  const evidence = hostAwakeEvidence(
    "darwin",
    [
      line("DarkWake"),
      line("Wake Requests", "timer due"),
      line("Kernel Client Acks", "Delays to Wake notifications"),
      line("PM Client Acks", "Delays to Sleep notifications"),
    ].join("\n"),
    0,
  );
  assert.equal(evidence.lastTransition.state, "DarkWake");
  assert.equal(evidence.eligible, false);
});

test.each(["", "truncated or invalid power log"])(
  "unknown macOS power state refuses work: %s",
  (log) => {
    const evidence = hostAwakeEvidence("darwin", log, 0);
    assert.equal(evidence.reason, "power_state_unknown");
    assert.throws(() => requireHostAwake(evidence));
  },
);

test("macOS-only gate does not claim verification of other platforms", () => {
  const evidence = hostAwakeEvidence("linux", "", 0);
  assert.equal(evidence.reason, "not_applicable");
  assert.equal(evidence.lastTransition, null);
  assert.equal(evidence.eligible, true);
});
