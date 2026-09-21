/** Static experimental guidance. It creates neither a test oracle nor a
 * completion/permission gate; actual execution and outcomes remain evidence. */
export const CONTRACT_VERIFICATION_PROTOCOL = [
  '<contract_verification_protocol version="contract-first-v1">',
  "For behavior-changing coding tasks, derive expected results from the user's requirements, designated specifications and the original public interface before changing the implementation. The existing implementation may be defective; it cannot override the stated contract.",
  "When execution is available, run relevant existing tests and small, focused contract checks before the first implementation edit. Cover accepted and rejected input classes, omitted versus supplied values, boundary values, and relevant state transitions. Preserve the specified error delivery, ordering, identity and side-effect timing. Use only authorized tools and files; use admitted inline checks when new files are outside scope.",
  "Keep expected results independent of the implementation being tested. Reuse the same assertions after edits. Change an expectation only when an amended requirement or a corrected reading of its source justifies it, and identify that source. Do not revise an assertion merely to match the implementation's current output.",
  "Distinguish a required concrete type or format from objects that merely have similar fields or methods. Check convincing invalid lookalikes as well as obviously invalid values. Do not broaden accepted inputs, add compatibility fallbacks or weaken validation without support in the contract; a plausible compatibility rationale is an assumption to verify, not an amended requirement.",
  "Baseline failures describe the starting behavior and do not justify abandoning the repair. If execution is unavailable, retain source-grounded expectations, state the concrete verification limitation and continue work that is possible within the existing permissions.",
  "A passing check proves only its actual assertions. Before completion, compare the requested contract with the behavior checked and report any remaining unverified part. This protocol grants no tools or permissions and does not make self-authored checks an independent correctness verdict.",
  "</contract_verification_protocol>",
].join("\n");

/** An explicit new strategy: retain v1 byte-for-byte for existing bound Runs. */
export const CONTRACT_TRANSITION_VERIFICATION_PROTOCOL =
  CONTRACT_VERIFICATION_PROTOCOL.replace(
    'version="contract-first-v1"',
    'version="contract-transitions-v2"',
  ).replace(
    "</contract_verification_protocol>",
    [
      "For stateful behavior, derive a small transition checklist from the contract: state before a call, accepted or rejected operation, returned value or error, observable effects, and state afterward. Keep this reasoning within existing task scope; no extra report or test file is required.",
      "Test WHEN each constraint must hold. Distinguish checks required before dispatch, before any return, on an incomplete operation, or only at finalization. Do not assume a later call will validate an earlier return path. Where the contract permits partial work, exercise invalid intermediate states and a valid boundary split across calls, as well as a complete operation in one call.",
      "For rejection paths, check the next permitted and rejected calls against the specified failure-state rules, including empty inputs and repeated terminal calls when relevant. Check returned results and externally visible effects at the point the contract specifies, not only the eventual final state. Do not invent poisoning, atomicity, retryability or eager validation where the contract does not require it.",
      "Before completion, reconcile each mandatory timing/state obligation with an actual assertion or source inspection. A passing final-state test does not cover an untested intermediate return. Reuse source-grounded assertions after edits; disclose uncovered obligations instead of treating successful test commands as proof of the complete contract.",
      "</contract_verification_protocol>",
    ].join("\n"),
  );

/** Stage execution before expanding checks; retain all v2 contract obligations.
 * This opt-in strategy changes guidance, not verification or completion gates. */
export const CONTRACT_STAGED_VERIFICATION_PROTOCOL =
  CONTRACT_TRANSITION_VERIFICATION_PROTOCOL.replace(
    'version="contract-transitions-v2"',
    'version="contract-staged-v3"',
  ).replace(
    '<contract_verification_protocol version="contract-staged-v3">',
    [
      '<contract_verification_protocol version="contract-staged-v3">',
      "Stage verification around observed results. Once the relevant source and existing test command are known, execute that baseline before designing the full repair or an expanded test program. A known authorized baseline needs no rehearsal of future implementation or tool calls. Then add small source-grounded checks for the gaps, execute them, and use the results to guide the edit. Reuse those checks after changes and complete the contract-coverage review before finishing. This sequencing preserves every verification obligation below.",
      "Resolve behavior from the designated specification and public interface. Do not invent alternate requirements by guessing hidden tests, grader implementation or evaluation conventions. When the specification names an error type, accepted input or timing rule, follow it directly; do not broaden behavior to hedge against hypothetical expectations. A genuine conflict between supplied sources needs evidence and a scoped resolution, not speculative compatibility behavior.",
    ].join("\n"),
  );
