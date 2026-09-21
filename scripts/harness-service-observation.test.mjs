import { test } from "vitest";
import assert from "node:assert/strict";
import { serviceObservationPassed } from "./harness-service-observation.mjs";

test("library tasks do not require an unrelated HTTP observer", () => {
  assert.equal(serviceObservationPassed(false, []), true);
});
test("required service evidence rejects absent, partial or failed observations", () => {
  assert.equal(serviceObservationPassed(true, []), false);
  assert.equal(
    serviceObservationPassed(true, [{ passed: true }, { passed: false }]),
    false,
  );
  assert.equal(serviceObservationPassed(true, [{}]), false);
  assert.equal(serviceObservationPassed(true, [{ passed: true }]), true);
  assert.throws(() => serviceObservationPassed("false", []), /Invalid/u);
});
