import type { RunEvent, StreamFrame } from "@napier/contracts";
import type { HarnessPolicyPresetId } from "@napier/contracts/harness-experiments";
import { NapierStreamResponseContractError } from "./api-error";
import { sha256Canonical } from "./stable-digest";

/** Per-stream evidence, checked before a selected strategy is shown as accepted. */
export function harnessPolicyEvidence(
  path: string,
  expected: HarnessPolicyPresetId | undefined,
) {
  let boundRunId: string | undefined;
  let snapshotEvents: RunEvent[] = [];
  return async (frame: StreamFrame): Promise<void> => {
    if (frame.type === "snapshot") {
      snapshotEvents = frame.detail.events.filter(
        (event) =>
          event.type === "harness.policy.bound" || event.type === "run.started",
      );
    }
    if (frame.type === "done") {
      const bindings = snapshotEvents.filter(
        (event) =>
          event.runId === frame.runId && event.type === "harness.policy.bound",
      );
      if (!expected) {
        if (bindings.length) invalid(path, expected);
      } else {
        const starts = snapshotEvents.filter(
          (event) =>
            event.runId === frame.runId && event.type === "run.started",
        );
        const binding = bindings[0],
          start = starts[0];
        if (
          bindings.length !== 1 ||
          starts.length !== 1 ||
          !binding ||
          !start ||
          binding.threadId !== frame.threadId ||
          start.threadId !== frame.threadId ||
          binding.seq >= start.seq ||
          (boundRunId !== undefined && boundRunId !== frame.runId) ||
          !(await matchesBinding(binding.payload, frame.runId, expected))
        )
          invalid(path, expected);
      }
    }
    if (frame.type !== "event") return;
    const event = frame.event;
    if (event.type === "harness.policy.bound") {
      if (
        !expected ||
        boundRunId ||
        !(await matchesBinding(event.payload, event.runId, expected))
      ) {
        invalid(path, expected);
      }
      boundRunId = event.runId;
    }
    if (
      event.type === "run.started" &&
      expected &&
      boundRunId !== event.runId
    ) {
      invalid(path, expected);
    }
  };
}

async function matchesBinding(
  input: unknown,
  runId: string | undefined,
  expected: HarnessPolicyPresetId,
) {
  if (!record(input) || typeof input["profileJson"] !== "string") return false;
  const { contentSha256, ...content } = input;
  if (
    input["kind"] !== "napier.harness-policy-binding" ||
    input["schemaVersion"] !== 1 ||
    input["runId"] !== runId ||
    (await sha256Canonical(content)) !== contentSha256
  )
    return false;
  let profile: unknown;
  try {
    profile = JSON.parse(input["profileJson"]);
  } catch {
    return false;
  }
  if (!record(profile) || !record(profile["policies"])) return false;
  const { contentSha256: profileHash, ...profileContent } = profile;
  const { contentSha256: policyHash, ...policyContent } = profile["policies"];
  return (
    profile["id"] === `napier.harness-preset.${expected}` &&
    profile["policies"]["id"] === expected &&
    profileHash === input["profileSha256"] &&
    (await sha256Canonical(profileContent)) === profileHash &&
    (await sha256Canonical(policyContent)) === policyHash
  );
}

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function invalid(
  path: string,
  expected: HarnessPolicyPresetId | undefined,
): never {
  throw new NapierStreamResponseContractError(path, {
    status: 200,
    header: "harness.policy.bound",
    expected: expected ?? "absent",
  });
}
