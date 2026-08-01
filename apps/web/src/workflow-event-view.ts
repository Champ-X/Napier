import type { RunEvent } from "@napier/contracts";

import { workflowLoopEventTraceParts } from "./workflow-loop-event-view";
import { workflowReduceEventTraceParts } from "./workflow-reduce-event-view";

const WORKFLOW_EVENTS = new Set([
  "workflow.started",
  "workflow.node.started",
  "workflow.node.completed",
  "workflow.node.skipped",
  "workflow.node.failed",
  "workflow.node.reused",
  "workflow.node.simulated",
  "workflow.approval.requested",
  "workflow.deterministic.completed",
  "workflow.reduce.completed",
  "workflow.map.item.started",
  "workflow.map.item.completed",
  "workflow.map.item.failed",
  "workflow.map.completed",
  "workflow.loop.iteration.started",
  "workflow.loop.iteration.completed",
  "workflow.loop.iteration.failed",
  "workflow.loop.checkpoint.reused",
  "workflow.loop.completed",
  "workflow.artifacts.settled",
  "workflow.artifacts.failed",
  "workflow.breakpoint.reached",
  "workflow.breakpoint.continued",
  "workflow.experiment.started",
  "workflow.experiment.compared",
  "workflow.experiment.failed",
  "workflow.completed",
  "workflow.waiting",
  "workflow.paused",
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
    const executionMode = payload["executionMode"];
    const executionNodeIds = nodeIds(payload["executionNodeIds"]);
    const stopBeforeNodeIds = nodeIds(payload["stopBeforeNodeIds"]);
    const simulationNodeId = nodeId(payload["simulationNodeId"]);
    const simulatedOutputSha256 = hash(payload["simulatedOutputSha256"]);
    const simulatedOutputBytes = boundedInteger(
      payload["simulatedOutputBytes"],
      1,
      32 * 1024,
    );
    const previewSha256 = hash(payload["previewSha256"]);
    if (
      !fromNodeId ||
      !reusedNodeIds ||
      !rerunNodeIds ||
      !previewSha256 ||
      typeof payload["sideEffectsConfirmed"] !== "boolean" ||
      (executionMode !== undefined &&
        executionMode !== "single_node" &&
        executionMode !== "simulate_node") ||
      (executionMode === "single_node"
        ? !executionNodeIds ||
          !stopBeforeNodeIds ||
          executionNodeIds.length !== 1 ||
          executionNodeIds[0] !== fromNodeId ||
          stopBeforeNodeIds.length > 16 ||
          simulationNodeId !== undefined ||
          simulatedOutputSha256 !== undefined ||
          simulatedOutputBytes !== undefined
        : executionMode === "simulate_node"
          ? !executionNodeIds ||
            stopBeforeNodeIds !== undefined ||
            simulationNodeId !== fromNodeId ||
            !simulatedOutputSha256 ||
            simulatedOutputBytes === undefined
          : executionNodeIds !== undefined ||
            stopBeforeNodeIds !== undefined ||
            simulationNodeId !== undefined ||
            simulatedOutputSha256 !== undefined ||
            simulatedOutputBytes !== undefined)
    ) {
      return undefined;
    }
    parts.push(
      `from ${fromNodeId}`,
      `reused ${String(reusedNodeIds.length)}`,
      `rerun ${String(rerunNodeIds.length)}`,
      ...(executionMode === "single_node"
        ? [
            "mode single-node",
            `execute ${String(executionNodeIds!.length)}`,
            `stop-before ${String(stopBeforeNodeIds!.length)}`,
          ]
        : executionMode === "simulate_node"
          ? [
              "mode simulate-node",
              `execute ${String(executionNodeIds!.length)}`,
              `simulated ${simulationNodeId}`,
              `simulation ${simulatedOutputSha256!.slice(0, 12)}`,
              `bytes ${String(simulatedOutputBytes)}`,
            ]
          : []),
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
  } else if (event.type === "workflow.node.simulated") {
    const nodeIdValue = nodeId(payload["nodeId"]);
    const inputSha256 = hash(payload["inputSha256"]);
    const outputSha256 = hash(payload["outputSha256"]);
    const outputSchemaSha256 = hash(payload["outputSchemaSha256"]);
    const outputBytes = boundedInteger(payload["outputBytes"], 1, 32 * 1024);
    if (
      !nodeIdValue ||
      !inputSha256 ||
      !outputSha256 ||
      !outputSchemaSha256 ||
      outputBytes === undefined
    ) {
      return undefined;
    }
    parts.push(
      `node ${nodeIdValue}`,
      `input ${inputSha256.slice(0, 12)}`,
      `output ${outputSha256.slice(0, 12)}`,
      `bytes ${String(outputBytes)}`,
      `output-schema ${outputSchemaSha256.slice(0, 12)}`,
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
    const breakpointNodeIds =
      payload["breakBeforeNodeIds"] === undefined
        ? []
        : nodeIds(payload["breakBeforeNodeIds"]);
    if (
      version === undefined ||
      nodeCount === undefined ||
      maxConcurrency === undefined ||
      !inputSha256 ||
      !inputSchemaSha256 ||
      !outputSchemaSha256 ||
      !breakpointNodeIds ||
      breakpointNodeIds.length > 16 ||
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
      ...(breakpointNodeIds.length > 0
        ? [`breakpoints ${String(breakpointNodeIds.length)}`]
        : []),
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
  } else if (event.type === "workflow.reduce.completed") {
    const reduceParts = workflowReduceEventTraceParts(payload);
    if (!reduceParts) return undefined;
    parts.push(...reduceParts);
  } else if (event.type.startsWith("workflow.artifacts.")) {
    const artifactCount = boundedInteger(payload["artifactCount"], 1, 16);
    const artifactSetSha256 = hash(payload["artifactSetSha256"]);
    if (artifactCount === undefined || !artifactSetSha256) return undefined;
    const artifactIdValue = nodeId(payload["artifactId"]);
    if (payload["artifactId"] !== undefined && !artifactIdValue) {
      return undefined;
    }
    if (artifactIdValue) {
      const errorCode = safeToken(payload["errorCode"]);
      const diagnosticSha256 = hash(payload["diagnosticSha256"]);
      if (
        event.type !== "workflow.artifacts.failed" ||
        !errorCode ||
        !diagnosticSha256
      ) {
        return undefined;
      }
      parts.push(
        `artifact ${artifactIdValue}`,
        `error ${errorCode}`,
        `diagnostic ${diagnosticSha256.slice(0, 12)}`,
        `artifacts ${String(artifactCount)}`,
        `set ${artifactSetSha256.slice(0, 12)}`,
      );
    } else {
      const verifiedCount = boundedInteger(
        payload["verifiedCount"],
        0,
        artifactCount,
      );
      const missingCount = boundedInteger(
        payload["missingCount"],
        0,
        artifactCount,
      );
      const failedCount = boundedInteger(
        payload["failedCount"],
        0,
        artifactCount,
      );
      const planRevision = boundedInteger(
        payload["planRevision"],
        1,
        1_000_000_000,
      );
      const expectedComplete = event.type === "workflow.artifacts.settled";
      if (
        verifiedCount === undefined ||
        missingCount === undefined ||
        failedCount === undefined ||
        planRevision === undefined ||
        payload["complete"] !== expectedComplete ||
        verifiedCount + missingCount > artifactCount ||
        (expectedComplete &&
          (verifiedCount !== artifactCount ||
            missingCount !== 0 ||
            failedCount !== 0))
      ) {
        return undefined;
      }
      parts.push(
        `verified ${String(verifiedCount)}/${String(artifactCount)}`,
        ...(missingCount > 0 ? [`missing ${String(missingCount)}`] : []),
        ...(failedCount > 0 ? [`failed ${String(failedCount)}`] : []),
        `plan-r${String(planRevision)}`,
        `set ${artifactSetSha256.slice(0, 12)}`,
      );
    }
  } else if (event.type.startsWith("workflow.breakpoint.")) {
    const nodeIdValue = nodeId(payload["nodeId"]);
    const breakpointIndex = boundedInteger(payload["breakpointIndex"], 0, 15);
    const breakpointCount = boundedInteger(payload["breakpointCount"], 1, 16);
    const bindingContextSha256 = hash(payload["bindingContextSha256"]);
    const planRevision = boundedInteger(
      payload["planRevision"],
      1,
      1_000_000_000,
    );
    if (
      !nodeIdValue ||
      breakpointIndex === undefined ||
      breakpointCount === undefined ||
      breakpointIndex >= breakpointCount ||
      !bindingContextSha256 ||
      planRevision === undefined
    ) {
      return undefined;
    }
    parts.push(
      `node ${nodeIdValue}`,
      `breakpoint ${String(breakpointIndex + 1)}/${String(breakpointCount)}`,
      `binding ${bindingContextSha256.slice(0, 12)}`,
      `plan-r${String(planRevision)}`,
    );
    if (event.type === "workflow.breakpoint.continued") {
      const reachedEventSeq = boundedInteger(
        payload["reachedEventSeq"],
        1,
        Number.MAX_SAFE_INTEGER,
      );
      if (reachedEventSeq === undefined || reachedEventSeq >= event.seq) {
        return undefined;
      }
      parts.push(`reached-seq ${String(reachedEventSeq)}`);
    }
  } else if (event.type.startsWith("workflow.loop.")) {
    const loopParts = workflowLoopEventTraceParts(event.type, payload);
    if (!loopParts) return undefined;
    parts.push(...loopParts);
  } else if (event.type.startsWith("workflow.map.item.")) {
    const nodeIdValue = nodeId(payload["nodeId"]);
    const coordinatorRunId = runId(payload["coordinatorRunId"]);
    const attempt = boundedInteger(payload["attempt"], 1, 3);
    const itemIndex = boundedInteger(payload["itemIndex"], 0, 15);
    const itemCount = boundedInteger(payload["itemCount"], 1, 16);
    const itemInputSha256 = hash(payload["itemInputSha256"]);
    const mapConfigurationSha256 = hash(payload["mapConfigurationSha256"]);
    if (
      !nodeIdValue ||
      !coordinatorRunId ||
      attempt === undefined ||
      itemIndex === undefined ||
      itemCount === undefined ||
      itemIndex >= itemCount ||
      !itemInputSha256 ||
      !mapConfigurationSha256
    ) {
      return undefined;
    }
    parts.push(
      `node ${nodeIdValue}`,
      `attempt ${String(attempt)}`,
      `item ${String(itemIndex + 1)}/${String(itemCount)}`,
      `input ${itemInputSha256.slice(0, 12)}`,
      `map ${mapConfigurationSha256.slice(0, 12)}`,
    );
    if (event.type === "workflow.map.item.completed") {
      const itemOutputSha256 = hash(payload["itemOutputSha256"]);
      const itemOutputSchemaSha256 = hash(payload["itemOutputSchemaSha256"]);
      const itemOutputBytes = boundedInteger(
        payload["itemOutputBytes"],
        0,
        32 * 1024,
      );
      if (
        !itemOutputSha256 ||
        !itemOutputSchemaSha256 ||
        itemOutputBytes === undefined
      ) {
        return undefined;
      }
      parts.push(
        `output ${itemOutputSha256.slice(0, 12)}`,
        `bytes ${String(itemOutputBytes)}`,
      );
    } else if (event.type === "workflow.map.item.failed") {
      const errorCode = safeToken(payload["errorCode"]);
      const diagnosticSha256 = hash(payload["diagnosticSha256"]);
      if (!errorCode || !diagnosticSha256) return undefined;
      parts.push(
        `error ${errorCode}`,
        `diagnostic ${diagnosticSha256.slice(0, 12)}`,
      );
    } else if (!hash(payload["itemOutputSchemaSha256"])) {
      return undefined;
    }
  } else if (event.type === "workflow.map.completed") {
    const nodeIdValue = nodeId(payload["nodeId"]);
    const attempt = boundedInteger(payload["attempt"], 1, 3);
    const itemCount = boundedInteger(payload["itemCount"], 0, 16);
    const maxConcurrency = boundedInteger(payload["maxConcurrency"], 1, 3);
    const outputSha256 = hash(payload["outputSha256"]);
    const outputSchemaSha256 = hash(payload["outputSchemaSha256"]);
    const itemInputSetSha256 = hash(payload["itemInputSetSha256"]);
    const itemOutputSetSha256 = hash(payload["itemOutputSetSha256"]);
    const itemRunSetSha256 = hash(payload["itemRunSetSha256"]);
    const mapConfigurationSha256 = hash(payload["mapConfigurationSha256"]);
    const outputBytes = boundedInteger(payload["outputBytes"], 0, 32 * 1024);
    if (
      !nodeIdValue ||
      attempt === undefined ||
      itemCount === undefined ||
      maxConcurrency === undefined ||
      !outputSha256 ||
      !outputSchemaSha256 ||
      !itemInputSetSha256 ||
      !itemOutputSetSha256 ||
      !itemRunSetSha256 ||
      !mapConfigurationSha256 ||
      outputBytes === undefined
    ) {
      return undefined;
    }
    parts.push(
      `node ${nodeIdValue}`,
      `attempt ${String(attempt)}`,
      `items ${String(itemCount)}`,
      `concurrency ${String(maxConcurrency)}`,
      `output ${outputSha256.slice(0, 12)}`,
      `bytes ${String(outputBytes)}`,
      `map ${mapConfigurationSha256.slice(0, 12)}`,
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
    } else if (payload["nodeType"] === "map") {
      const mapConfigurationSha256 = hash(payload["mapConfigurationSha256"]);
      if (!mapConfigurationSha256) return undefined;
      parts.push(`map ${mapConfigurationSha256.slice(0, 12)}`);
    } else if (payload["nodeType"] === "loop") {
      const loopConfigurationSha256 = hash(payload["loopConfigurationSha256"]);
      if (!loopConfigurationSha256) return undefined;
      parts.push(`loop ${loopConfigurationSha256.slice(0, 12)}`);
    } else if (payload["nodeType"] === "reduce") {
      const reduceConfigurationSha256 = hash(
        payload["reduceConfigurationSha256"],
      );
      if (!reduceConfigurationSha256) return undefined;
      parts.push(`reduce ${reduceConfigurationSha256.slice(0, 12)}`);
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
    if (status === "paused") {
      const nodeIdValue = nodeId(payload["breakpointNodeId"]);
      const breakpointIndex = boundedInteger(payload["breakpointIndex"], 0, 15);
      const breakpointCount = boundedInteger(payload["breakpointCount"], 1, 16);
      const reachedEventSeq = boundedInteger(
        payload["breakpointReachedEventSeq"],
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const bindingContextSha256 = hash(
        payload["breakpointBindingContextSha256"],
      );
      if (
        !nodeIdValue ||
        breakpointIndex === undefined ||
        breakpointCount === undefined ||
        breakpointIndex >= breakpointCount ||
        reachedEventSeq === undefined ||
        !bindingContextSha256
      ) {
        return undefined;
      }
      parts.push(
        `before ${nodeIdValue}`,
        `breakpoint ${String(breakpointIndex + 1)}/${String(breakpointCount)}`,
        `binding ${bindingContextSha256.slice(0, 12)}`,
      );
    }
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
    value === "paused" ||
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

function runId(value: unknown): string | undefined {
  return typeof value === "string" && /^run_[a-z0-9]{8,80}$/u.test(value)
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
