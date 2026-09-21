import { createHash } from "node:crypto";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A live Run configuration, its started event, and all negotiation receipts
 * must agree. Missing degradation events alone do not establish readiness.
 * This records execution eligibility, not OS isolation or dependency identity. */
export function collectEnvironmentEvidence(
  run,
  events,
  requiredTools,
  sandboxId,
  { validateRunConfigurationFingerprint, canonicalJson, sha256 },
) {
  const blockers = [];
  let configuration;
  const receipts = [];
  const started = events.filter((event) => event.type === "run.started");
  try {
    configuration = validateRunConfigurationFingerprint(run.configuration);
    if (
      !configuration ||
      !["standard", "environment_degraded_read_only"].includes(
        configuration.executionMode,
      ) ||
      started.length !== 1 ||
      started[0].runId !== run.id ||
      started[0].payload.configurationSha256 !== configuration.contentSha256
    )
      throw new Error("configuration");
  } catch {
    blockers.push("Missing or invalid Run configuration/start binding");
    configuration = undefined;
  }
  const negotiated = events.filter(
    (event) => event.type === "run.environment.negotiated",
  );
  for (const event of negotiated) {
    const { contentSha256, ...content } = event.payload ?? {};
    if (
      event.runId !== run.id ||
      content.kind !== "napier.environment-capability-negotiation" ||
      content.schemaVersion !== 1 ||
      content.sandboxId !== sandboxId ||
      content.executionMode !== "environment_degraded_read_only" ||
      content.status !== "degraded_read_only" ||
      content.reason !== "sandbox_unavailable" ||
      sha256(canonicalJson(content)) !== contentSha256 ||
      !Array.isArray(content.activeToolNames) ||
      !Array.isArray(content.omittedToolNames) ||
      content.activeToolCount !== content.activeToolNames.length ||
      content.configuredToolCount !==
        content.activeToolNames.length + content.omittedToolNames.length ||
      canonicalJson(content.activeToolNames.toSorted()) !==
        canonicalJson(configuration?.enabledTools?.toSorted())
    ) {
      blockers.push("Invalid or foreign environment negotiation receipt");
      continue;
    }
    receipts.push({
      eventId: event.id,
      contentSha256,
      reason: content.reason,
      readinessId: content.readinessId,
      readinessDetailSha256: content.readinessDetailSha256,
      omittedToolNames: content.omittedToolNames,
    });
  }
  const mode = configuration?.executionMode ?? "unknown";
  if (
    (mode === "standard" && negotiated.length !== 0) ||
    (mode === "environment_degraded_read_only" && negotiated.length !== 1)
  )
    blockers.push("Execution mode and negotiation receipts disagree");
  const missingTools = [...new Set(requiredTools)]
    .filter((name) => !configuration?.enabledTools?.includes(name))
    .sort();
  const valid = blockers.length === 0;
  const content = {
    kind: "napier.harness-environment-evidence",
    schemaVersion: 1,
    runId: run.id,
    sandboxId,
    configurationSha256: configuration?.contentSha256 ?? null,
    executionMode: mode,
    valid,
    eligible: valid && mode === "standard" && missingTools.length === 0,
    missingTools,
    receipts,
    blockers,
  };
  return { ...content, contentSha256: digest(content) };
}

export function environmentEvidenceEligible(report) {
  const evidence = report.environmentEvidence;
  if (!evidence || typeof evidence !== "object") return false;
  const { contentSha256, ...content } = evidence;
  return (
    content.kind === "napier.harness-environment-evidence" &&
    content.schemaVersion === 1 &&
    content.runId === report.runId &&
    content.sandboxId === report.sandbox &&
    /^[a-f0-9]{64}$/u.test(content.configurationSha256) &&
    content.valid === true &&
    content.eligible === true &&
    content.executionMode === "standard" &&
    Array.isArray(content.missingTools) &&
    content.missingTools.length === 0 &&
    Array.isArray(content.receipts) &&
    content.receipts.length === 0 &&
    Array.isArray(content.blockers) &&
    content.blockers.length === 0 &&
    digest(content) === contentSha256
  );
}
