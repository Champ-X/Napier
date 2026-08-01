import type { ExecutionPlanWorkflowNode, JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { executionPlanWorkflowConditionSha256 } from "./workflow-condition-model.js";
import {
  workflowDeterministicNodeMetadata,
  workflowDeterministicNodeMetadataMatches,
} from "./workflow-deterministic-evidence.js";
import {
  workflowJavascriptNodeMetadata,
  workflowJavascriptNodeMetadataMatches,
} from "./workflow-javascript-evidence.js";
import {
  workflowPythonNodeMetadata,
  workflowPythonNodeMetadataMatches,
} from "./workflow-python-evidence.js";
import { workflowLoopNodeConfigurationSha256 } from "./workflow-loop-model.js";
import {
  workflowMapNodeMetadata,
  workflowMapNodeMetadataMatches,
} from "./workflow-map-evidence.js";
import {
  workflowReduceNodeMetadata,
  workflowReduceNodeMetadataMatches,
} from "./workflow-reduce-evidence.js";

export function workflowNodeEventMetadataMatches(
  node: ExecutionPlanWorkflowNode,
  payload: Record<string, unknown>,
): boolean {
  if (!workflowNodeConditionMetadataMatches(node, payload)) return false;
  if (node.type === "tool") {
    return (
      payload["nodeType"] === "tool" &&
      payload["toolName"] === node.tool &&
      payload["effect"] === node.effect
    );
  }
  if (node.type === "approval") {
    return (
      payload["nodeType"] === "approval" &&
      payload["questionSha256"] === sha256(node.question)
    );
  }
  if (node.type === "deterministic") {
    return workflowDeterministicNodeMetadataMatches(
      node,
      payload as Record<string, JsonValue>,
    );
  }
  if (node.type === "map") {
    return workflowMapNodeMetadataMatches(
      node,
      payload as Record<string, JsonValue>,
    );
  }
  if (node.type === "loop") {
    return (
      payload["nodeType"] === "loop" &&
      payload["loopConfigurationSha256"] ===
        workflowLoopNodeConfigurationSha256(node)
    );
  }
  if (node.type === "reduce") {
    return workflowReduceNodeMetadataMatches(
      node,
      payload as Record<string, JsonValue>,
    );
  }
  if (node.type === "javascript") {
    return workflowJavascriptNodeMetadataMatches(
      node,
      payload as Record<string, JsonValue>,
    );
  }
  if (node.type === "python") {
    return workflowPythonNodeMetadataMatches(
      node,
      payload as Record<string, JsonValue>,
    );
  }
  return payload["nodeType"] === undefined || payload["nodeType"] === "agent";
}

export function workflowNodeEventMetadata(
  node: ExecutionPlanWorkflowNode,
): Record<string, JsonValue> {
  const condition = workflowNodeConditionMetadata(node);
  if (node.type === "tool") {
    return {
      nodeType: "tool",
      toolName: node.tool,
      effect: node.effect,
      ...condition,
    };
  }
  if (node.type === "approval") {
    return {
      nodeType: "approval",
      questionSha256: sha256(node.question),
      ...condition,
    };
  }
  if (node.type === "deterministic") {
    return { ...workflowDeterministicNodeMetadata(node), ...condition };
  }
  if (node.type === "map") {
    return { ...workflowMapNodeMetadata(node), ...condition };
  }
  if (node.type === "loop") {
    return {
      nodeType: "loop",
      loopConfigurationSha256: workflowLoopNodeConfigurationSha256(node),
      ...condition,
    };
  }
  if (node.type === "reduce") {
    return { ...workflowReduceNodeMetadata(node), ...condition };
  }
  if (node.type === "javascript") {
    return { ...workflowJavascriptNodeMetadata(node), ...condition };
  }
  if (node.type === "python") {
    return { ...workflowPythonNodeMetadata(node), ...condition };
  }
  return { nodeType: "agent", ...condition };
}

function workflowNodeConditionMetadataMatches(
  node: ExecutionPlanWorkflowNode,
  payload: Record<string, unknown>,
): boolean {
  if (!node.when || node.skipOutput === undefined) {
    return (
      payload["conditionSha256"] === undefined &&
      payload["skipOutputSha256"] === undefined
    );
  }
  return (
    payload["conditionSha256"] ===
      executionPlanWorkflowConditionSha256(node.when) &&
    payload["skipOutputSha256"] === sha256(canonicalJson(node.skipOutput))
  );
}

function workflowNodeConditionMetadata(
  node: ExecutionPlanWorkflowNode,
): Record<string, JsonValue> {
  if (!node.when || node.skipOutput === undefined) return {};
  return {
    conditionSha256: executionPlanWorkflowConditionSha256(node.when),
    skipOutputSha256: sha256(canonicalJson(node.skipOutput)),
  };
}
