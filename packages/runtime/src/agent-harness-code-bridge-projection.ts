import type { HarnessLedgerRunEvidence } from "@napier/contracts/agent-harness-acceptance";

export function governedBridgeCall(
  run: HarnessLedgerRunEvidence,
  callId: string,
): boolean {
  const authorized = findCall(run, "code_bridge.authorized", callId);
  const started = findCall(run, "tool.started", callId);
  const terminal =
    findCall(run, "tool.completed", callId) ??
    findCall(run, "tool.failed", callId);
  const invocation = findCall(run, "context.tool_invocation", callId);
  const result = findCall(run, "context.tool_result", callId);
  return Boolean(
    authorized &&
    started &&
    terminal &&
    invocation &&
    result &&
    invocation.seq < authorized.seq &&
    authorized.seq < started.seq &&
    started.seq < result.seq &&
    result.seq < terminal.seq &&
    field(started.payload, "nestedDispatch") === true &&
    field(terminal.payload, "nestedDispatch") === true &&
    field(authorized.payload, "inputSha256") ===
      field(started.payload, "inputSha256") &&
    field(authorized.payload, "inputSha256") ===
      field(invocation.payload, "argumentsSha256") &&
    field(authorized.payload, "toolVersionSha256") ===
      field(invocation.payload, "toolDefinitionSha256") &&
    field(result.payload, "invocationCapsuleSha256") ===
      field(invocation.payload, "capsuleSha256") &&
    field(authorized.payload, "validationChecked") === true &&
    field(authorized.payload, "policyChecked") === true &&
    field(authorized.payload, "workspaceBoundaryChecked") === true &&
    field(authorized.payload, "budgetChecked") === true &&
    field(authorized.payload, "sandboxDelegated") === true,
  );
}

export function privilegeProbeBlocked(
  run: HarnessLedgerRunEvidence,
  callId: string,
  probeClass: string,
): boolean {
  const blocked = findCall(run, "tool.blocked", callId);
  if (!blocked || findCall(run, "tool.started", callId)) return false;
  const reason = String(field(blocked.payload, "policyReason") ?? "");
  const checks: Record<string, boolean> = {
    workspace_escape: /escapes? (?:the )?configured workspace/u.test(reason),
    inactive_capability: /not active for this step/u.test(reason),
    unknown_effect:
      /requires an approval checkpoint outside the code session/u.test(
        reason,
      ) &&
      field(blocked.payload, "harnessInterventionReason") === "approval_block",
  };
  return checks[probeClass] === true;
}

function findCall(run: HarnessLedgerRunEvidence, type: string, callId: string) {
  return run.events.find(
    (event) => event.type === type && field(event.payload, "callId") === callId,
  );
}

function field(value: unknown, key: string): unknown {
  return record(value) ? value[key] : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
