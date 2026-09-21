import { validateToolArguments } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { sha256 } from "../src/ed25519.js";
import {
  legacyToolFailureLedgerProjection,
  legacyToolFailureReceipt,
} from "../src/tool-failure-legacy-fallback.js";

function validation(argumentsText: string) {
  return [
    'Validation failed for tool "run_command":',
    "  - args.1: must match the argument schema",
    "",
    "Received arguments:",
    JSON.stringify({ runtime: "node", args: ["-e", argumentsText] }),
  ].join("\n");
}

it.each([
  "assert.equal(status, 429)",
  "const timeout = 1000",
  'console.log("session closed")',
  'console.log("unsupported")',
  'console.log("cancelled")',
  'console.log("missing credentials")',
  'console.log("permission denied")',
])(
  "schema rejection stays invocation-scoped when echoed code contains %s",
  (code) => {
    const output = validation(code);
    for (const failure of [
      output,
      new Error(output),
      { output, details: {} },
    ]) {
      expect(legacyToolFailureReceipt(failure)).toMatchObject({
        coverage: "legacy_fallback",
        class: "invalid_input",
        scope: "invocation",
        disposition: "correct_input",
        fatalToSession: false,
      });
    }
    expect(
      legacyToolFailureLedgerProjection(output, {}).toolFailure,
    ).toMatchObject({
      class: "invalid_input",
      disposition: "correct_input",
      fatalToSession: false,
    });
  },
);

it.each([
  ["HTTP 429: request validation failed", "rate_limited"],
  ["request timed out during schema validation", "timeout"],
  ["session closed during validation", "session_state"],
  [`HTTP 401: ${validation("value")}`, "unauthorized"],
])("preserves ordinary failure classification for %s", (output, expected) => {
  expect(legacyToolFailureReceipt(output).class).toBe(expected);
});

it("retains the bounded original diagnostic hash including echoed arguments", () => {
  const output = validation("status: 429; " + "private fixture ".repeat(2_000));
  const original = { output, details: {} };
  expect(legacyToolFailureReceipt(original)).toMatchObject({
    class: "invalid_input",
    diagnosticSha256: sha256(`${output}\n{}`.slice(0, 16_000)),
  });
  expect(original.output).toBe(output);
});

it("recognizes the installed SDK's real schema-validation error", () => {
  let failure: unknown;
  try {
    validateToolArguments(
      {
        name: "run_command",
        description: "Node argument fixture",
        parameters: Type.Object({
          args: Type.Array(
            Type.String({ pattern: "^[^\\u0000-\\u001f\\u007f]*$" }),
          ),
        }),
      },
      {
        type: "toolCall",
        id: "validation-fixture",
        name: "run_command",
        arguments: { args: ["-e", "assert.equal(status, 429);\nvoid 0;"] },
      },
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(legacyToolFailureReceipt(failure)).toMatchObject({
    class: "invalid_input",
    scope: "invocation",
    disposition: "correct_input",
    fatalToSession: false,
  });
});
