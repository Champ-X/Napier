import type { RunEvent } from "@napier/contracts";

const WORKFLOW_EVENTS = new Set([
  "workflow.started",
  "workflow.node.started",
  "workflow.node.completed",
  "workflow.node.skipped",
  "workflow.node.failed",
  "workflow.node.reused",
  "workflow.approval.requested",
  "workflow.deterministic.completed",
  "workflow.experiment.started",
  "workflow.experiment.compared",
  "workflow.experiment.failed",
  "workflow.completed",
  "workflow.waiting",
  "workflow.blocked",
  "workflow.cancelled",
]);

export function workflowEventTraceSummary(event: RunEvent): string | undefined {
  if (!WORKFLOW_EVENTS.has(event.type) || !record(event.payload)) {
    return undefined;
  }
  const payload = event.payload;
  const manifestSha256 = hash(payload["manifestSha256"]);
  if (
    payload["schemaVersion"] !== 1 ||
    !planId(payload["planId"]) ||
    !manifestSha256
  ) {
    return undefined;
  }
  const parts = [event.type.replaceAll(".", " ")];
  if (event.type === "workflow.experiment.started") {
    const fromNodeId = nodeId(payload["fromNodeId"]);
    const reusedNodeIds = nodeIds(payload["reusedNodeIds"]);
    const rerunNodeIds = nodeIds(payload["rerunNodeIds"]);
    const previewSha256 = hash(payload["previewSha256"]);
    if (
      !fromNodeId ||
      !reusedNodeIds ||
      !rerunNodeIds ||
      !previewSha256 ||
      typeof payload["sideEffectsConfirmed"] !== "boolean"
    ) {
      return undefined;
    }
    parts.push(
      `from ${fromNodeId}`,
      `reused ${String(reusedNodeIds.length)}`,
      `rerun ${String(rerunNodeIds.length)}`,
      `preview ${previewSha256.slice(0, 12)}`,
      payload["sideEffectsConfirmed"] ? "side-effects confirmed" : "read-only",
    );
  } else if (event.type === "workflow.node.reused") {
    const nodeIdValue = nodeId(payload["nodeId"]);
    const inputSha256 = hash(payload["inputSha256"]);
    const outputSha256 = hash(payload["outputSha256"]);
    const skippedSource = payload["sourceStatus"] === "skipped";
    const sourceAttempt = boundedInteger(
      payload["sourceAttempt"],
      skippedSource ? 0 : 1,
      skippedSource ? 0 : 3,
    );
    if (
      !nodeIdValue ||
      !inputSha256 ||
      !outputSha256 ||
      sourceAttempt === undefined
    ) {
      return undefined;
    }
    parts.push(
      `node ${nodeIdValue}`,
      ...(skippedSource ? ["source-status skipped"] : []),
      `source-attempt ${String(sourceAttempt)}`,
      `input ${inputSha256.slice(0, 12)}`,
      `output ${outputSha256.slice(0, 12)}`,
    );
  } else if (event.type === "workflow.experiment.compared") {
    const comparisonSha256 = hash(payload["comparisonSha256"]);
    const sourceStatus = planStatus(payload["sourceStatus"]);
    const targetStatus = workflowStatus(payload["targetStatus"]);
    const changedNodeCount = boundedInteger(payload["changedNodeCount"], 0, 30);
    const outputChange = valueChange(payload["outputChange"]);
    const durationMsDelta = signedInteger(payload["durationMsDelta"]);
    const inputTokensDelta = signedInteger(payload["inputTokensDelta"]);
    const outputTokensDelta = signedInteger(payload["outputTokensDelta"]);
    const toolCallCountDelta = signedInteger(payload["toolCallCountDelta"]);
    const costUsdDelta = finiteNumber(payload["costUsdDelta"]);
    const evaluationCountDelta = signedInteger(payload["evaluationCountDelta"]);
    const artifactCountDelta = signedInteger(payload["artifactCountDelta"]);
    if (
      !comparisonSha256 ||
      !sourceStatus ||
      !targetStatus ||
      changedNodeCount === undefined ||
      !outputChange ||
      durationMsDelta === undefined ||
      inputTokensDelta === undefined ||
      outputTokensDelta === undefined ||
      toolCallCountDelta === undefined ||
      costUsdDelta === undefined ||
      evaluationCountDelta === undefined ||
      artifactCountDelta === undefined
    ) {
      return undefined;
    }
    parts.push(
      `${sourceStatus} -> ${targetStatus}`,
      `changed-nodes ${String(changedNodeCount)}`,
      `output ${outputChange}`,
      `duration ${signed(durationMsDelta)}ms`,
      `tokens ${signed(inputTokensDelta + outputTokensDelta)}`,
      `tools ${signed(toolCallCountDelta)}`,
      `cost ${signedFixed(costUsdDelta, 6)} USD`,
      `evaluations ${signed(evaluationCountDelta)}`,
      `artifacts ${signed(artifactCountDelta)}`,
      `comparison ${comparisonSha256.slice(0, 12)}`,
    );
  } else if (event.type === "workflow.experiment.failed") {
    const previewSha256 = hash(payload["previewSha256"]);
    const diagnosticSha256 = hash(payload["diagnosticSha256"]);
    if (!previewSha256 || !diagnosticSha256) return undefined;
    parts.push(
      `preview ${previewSha256.slice(0, 12)}`,
      `diagnostic ${diagnosticSha256.slice(0, 12)}`,
    );
  } else if (event.type === "workflow.started") {
    const version = boundedInteger(payload["workflowVersion"], 1, 1_000_000);
    const nodeCount = boundedInteger(payload["nodeCount"], 1, 30);
    const inputSha256 = hash(payload["inputSha256"]);
    const inputSchemaSha256 = hash(payload["inputSchemaSha256"]);
    const outputSchemaSha256 = hash(payload["outputSchemaSha256"]);
    const maxConcurrency =
      payload["maxConcurrency"] === undefined
        ? 1
        : boundedInteger(payload["maxConcurrency"], 1, 4);
    if (
      version === undefined ||
      nodeCount === undefined ||
      maxConcurrency === undefined ||
      !inputSha256 ||
      !inputSchemaSha256 ||
      !outputSchemaSha256 ||
      !nodeId(payload["outputNodeId"])
    ) {
      return undefined;
    }
    parts.push(
      `version ${String(version)}`,
      `nodes ${String(nodeCount)}`,
      `concurrency ${String(maxConcurrency)}`,
      `input ${inputSha256.slice(0, 12)}`,
      `input-schema ${inputSchemaSha256.slice(0, 12)}`,
      `output-schema ${outputSchemaSha256.slice(0, 12)}`,
    );
  } else if (event.type === "workflow.deterministic.completed") {
    const nodeIdValue = nodeId(payload["nodeId"]);
    const attempt = boundedInteger(payload["attempt"], 1, 3);
    const templateSha256 = hash(payload["templateSha256"]);
    const inputSha256 = hash(payload["inputSha256"]);
    const outputSha256 = hash(payload["outputSha256"]);
    const outputSchemaSha256 = hash(payload["outputSchemaSha256"]);
    const outputBytes = boundedInteger(payload["outputBytes"], 0, 32 * 1024);
    if (
      !nodeIdValue ||
      attempt === undefined ||
      !templateSha256 ||
      !inputSha256 ||
      !outputSha256 ||
      !outputSchemaSha256 ||
      outputBytes === undefined
    ) {
      return undefined;
    }
    parts.push(
      `node ${nodeIdValue}`,
      `attempt ${String(attempt)}`,
      `template ${templateSha256.slice(0, 12)}`,
      `input ${inputSha256.slice(0, 12)}`,
      `output ${outputSha256.slice(0, 12)}`,
      `bytes ${String(outputBytes)}`,
      `output-schema ${outputSchemaSha256.slice(0, 12)}`,
    );
  } else if (event.type === "workflow.approval.requested") {
    const nodeIdValue = nodeId(payload["nodeId"]);
    const decisionId = safeDecisionId(payload["decisionId"]);
    const questionSha256 = hash(payload["questionSha256"]);
    const requestSha256 = hash(payload["decisionRequestSha256"]);
    const expiresAt =
      typeof payload["expiresAt"] === "string" &&
      Number.isFinite(Date.parse(payload["expiresAt"]))
        ? payload["expiresAt"]
        : undefined;
    if (
      !nodeIdValue ||
      !decisionId ||
      !questionSha256 ||
      !requestSha256 ||
      !expiresAt
    ) {
      return undefined;
    }
    parts.push(
      `node ${nodeIdValue}`,
      `decision ${decisionId.slice(-10)}`,
      `question ${questionSha256.slice(0, 12)}`,
      `request ${requestSha256.slice(0, 12)}`,
      `expires ${expiresAt}`,
    );
  } else if (event.type.startsWith("workflow.node.")) {
    const nodeIdValue = nodeId(payload["nodeId"]);
    const attempt = boundedInteger(
      payload["attempt"],
      event.type === "workflow.node.skipped" ? 0 : 1,
      event.type === "workflow.node.skipped" ? 0 : 3,
    );
    const inputSha256 = hash(payload["inputSha256"]);
    const outputSchemaSha256 = hash(payload["outputSchemaSha256"]);
    if (
      !nodeIdValue ||
      attempt === undefined ||
      !inputSha256 ||
      !outputSchemaSha256
    ) {
      return undefined;
    }
    parts.push(
      `node ${nodeIdValue}`,
      `attempt ${String(attempt)}`,
      `input ${inputSha256.slice(0, 12)}`,
      `output-schema ${outputSchemaSha256.slice(0, 12)}`,
    );
    if (payload["nodeType"] === "tool") {
      const toolName = safeToken(payload["toolName"]);
      const effect =
        payload["effect"] === "read" || payload["effect"] === "write"
          ? payload["effect"]
          : undefined;
      if (!toolName || !effect) return undefined;
      parts.push(`tool ${toolName} (${effect})`);
    } else if (payload["nodeType"] === "approval") {
      const questionSha256 = hash(payload["questionSha256"]);
      if (!questionSha256) return undefined;
      parts.push(`approval ${questionSha256.slice(0, 12)}`);
    } else if (payload["nodeType"] === "deterministic") {
      const templateSha256 = hash(payload["templateSha256"]);
      if (!templateSha256) return undefined;
      parts.push(`deterministic ${templateSha256.slice(0, 12)}`);
    } else if (
      payload["nodeType"] !== undefined &&
      payload["nodeType"] !== "agent"
    ) {
      return undefined;
    }
    const conditionSha256 = hash(payload["conditionSha256"]);
    const skipOutputSha256 = hash(payload["skipOutputSha256"]);
    if (conditionSha256 || skipOutputSha256) {
      if (!conditionSha256 || !skipOutputSha256) return undefined;
      parts.push(
        `condition ${conditionSha256.slice(0, 12)}`,
        `skip-output ${skipOutputSha256.slice(0, 12)}`,
      );
    }
    if (event.type === "workflow.node.completed") {
      const outputSha256 = hash(payload["outputSha256"]);
      if (!outputSha256 || typeof payload["recovered"] !== "boolean") {
        return undefined;
      }
      parts.push(`output ${outputSha256.slice(0, 12)}`);
      if (payload["recovered"]) parts.push("recovered");
    }
    if (event.type === "workflow.node.skipped") {
      const outputSha256 = hash(payload["outputSha256"]);
      const subjectSha256 = hash(payload["conditionSubjectSha256"]);
      if (
        !conditionSha256 ||
        !skipOutputSha256 ||
        !outputSha256 ||
        !subjectSha256 ||
        payload["matched"] !== false ||
        typeof payload["recovered"] !== "boolean" ||
        typeof payload["reused"] !== "boolean"
      ) {
        return undefined;
      }
      parts.push(
        `subject ${subjectSha256.slice(0, 12)}`,
        `output ${outputSha256.slice(0, 12)}`,
        ...(payload["recovered"] ? ["recovered"] : []),
        ...(payload["reused"] ? ["reused"] : []),
      );
    }
    if (event.type === "workflow.node.failed") {
      const errorCode = safeToken(payload["errorCode"]);
      const diagnosticSha256 = hash(payload["diagnosticSha256"]);
      if (!errorCode || !diagnosticSha256) return undefined;
      parts.push(
        `error ${errorCode}`,
        `diagnostic ${diagnosticSha256.slice(0, 12)}`,
      );
    }
  } else {
    const status = workflowStatus(payload["status"]);
    const resultSha256 = hash(payload["resultSha256"]);
    const nodeResultCount = boundedInteger(payload["nodeResultCount"], 0, 30);
    const completedNodeCount = boundedInteger(
      payload["completedNodeCount"],
      0,
      30,
    );
    const skippedNodeCount =
      payload["skippedNodeCount"] === undefined
        ? 0
        : boundedInteger(payload["skippedNodeCount"], 0, 30);
    if (
      !status ||
      !resultSha256 ||
      nodeResultCount === undefined ||
      completedNodeCount === undefined ||
      skippedNodeCount === undefined ||
      completedNodeCount + skippedNodeCount > nodeResultCount
    ) {
      return undefined;
    }
    parts.push(
      `status ${status}`,
      `completed ${String(completedNodeCount)}/${String(nodeResultCount)}`,
      ...(skippedNodeCount > 0 ? [`skipped ${String(skippedNodeCount)}`] : []),
      `result ${resultSha256.slice(0, 12)}`,
    );
    const outputSha256 = hash(payload["outputSha256"]);
    if (outputSha256) parts.push(`output ${outputSha256.slice(0, 12)}`);
  }
  parts.push(`manifest ${manifestSha256.slice(0, 12)}`);
  return parts.join(" / ");
}

function safeDecisionId(value: unknown): string | undefined {
  return typeof value === "string" && /^decision_[a-z0-9]{8,80}$/u.test(value)
    ? value
    : undefined;
}

function workflowStatus(value: unknown): string | undefined {
  return value === "completed" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "cancelled"
    ? value
    : undefined;
}

function planStatus(value: unknown): string | undefined {
  return value === "active" ? value : workflowStatus(value);
}

function valueChange(value: unknown): string | undefined {
  return value === "unchanged" ||
    value === "changed" ||
    value === "became_available" ||
    value === "became_unavailable" ||
    value === "unavailable"
    ? value
    : undefined;
}

function planId(value: unknown): string | undefined {
  return typeof value === "string" && /^plan_[a-z0-9]{8,80}$/u.test(value)
    ? value
    : undefined;
}

function nodeId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/u.test(value)
    ? value
    : undefined;
}

function nodeIds(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some((item) => !nodeId(item)) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return value as string[];
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value)
    ? value
    : undefined;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function signedInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? Number(value) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}

function signedFixed(value: number, fractionDigits: number): string {
  const text = value.toFixed(fractionDigits);
  return value > 0 ? `+${text}` : text;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
