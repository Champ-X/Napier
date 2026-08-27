import type {
  SubagentHubActionResponseV1,
  SubagentHubProjectionV1,
} from "@napier/contracts/subagent-hub";
import { isSubagentHubTask } from "./subagent-hub-task-protocol";
import {
  exactKeys,
  nonNegativeInteger,
  optionalResourceId,
  positiveInteger,
  record,
  resourceId,
  timestamp,
} from "./subagent-hub-protocol-primitives";

export function isSubagentHubProjection(
  value: unknown,
  expectedThreadId?: string,
): value is SubagentHubProjectionV1 {
  if (
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "threadId",
      "taskCount",
      "selectedTaskCount",
      "activeTaskCount",
      "terminalTaskCount",
      "orphanedTaskCount",
      "omittedTaskCount",
      "eventWatermark",
      "tasks",
    ])
  )
    return false;
  const threadId = value["threadId"];
  const tasks = value["tasks"];
  const taskCount = value["taskCount"];
  const selectedTaskCount = value["selectedTaskCount"];
  const activeTaskCount = value["activeTaskCount"];
  const terminalTaskCount = value["terminalTaskCount"];
  const omittedTaskCount = value["omittedTaskCount"];
  if (
    value["kind"] !== "napier.subagent-hub-projection" ||
    value["schemaVersion"] !== 1 ||
    typeof threadId !== "string" ||
    (expectedThreadId !== undefined && threadId !== expectedThreadId) ||
    !nonNegativeInteger(taskCount) ||
    !nonNegativeInteger(selectedTaskCount) ||
    !nonNegativeInteger(activeTaskCount) ||
    !nonNegativeInteger(terminalTaskCount) ||
    !nonNegativeInteger(value["orphanedTaskCount"]) ||
    !nonNegativeInteger(omittedTaskCount) ||
    !nonNegativeInteger(value["eventWatermark"]) ||
    !Array.isArray(tasks) ||
    tasks.length > 24 ||
    tasks.length !== selectedTaskCount ||
    taskCount !== selectedTaskCount + omittedTaskCount ||
    taskCount !== activeTaskCount + terminalTaskCount ||
    !tasks.every(isSubagentHubTask)
  )
    return false;
  const ids = tasks.map((task) => (task as { taskId: string }).taskId);
  return new Set(ids).size === ids.length;
}

export function validateSubagentHubActionResponse(
  value: unknown,
  threadId: string,
  action: "steer" | "cancel" | "revive",
  sourceTaskId: string,
): SubagentHubActionResponseV1 {
  if (
    !record(value) ||
    !exactKeys(value, ["kind", "schemaVersion", "result", "hub"]) ||
    value["kind"] !== "napier.subagent-hub-action-response" ||
    value["schemaVersion"] !== 1 ||
    !isActionResult(value["result"], action, sourceTaskId) ||
    !isSubagentHubProjection(value["hub"], threadId)
  ) {
    throw new Error("Subagent Hub action response is invalid");
  }
  const response = value as unknown as SubagentHubActionResponseV1;
  if (
    !response.hub.tasks.some((task) => task.taskId === response.result.taskId)
  ) {
    throw new Error("Subagent Hub action response task is not projected");
  }
  return response;
}

function isActionResult(
  value: unknown,
  action: string,
  sourceTaskId: string,
): boolean {
  return (
    record(value) &&
    exactKeys(value, [
      "kind",
      "schemaVersion",
      "action",
      "sourceTaskId",
      "sourceTaskRevision",
      "taskId",
      "executionId",
      "messageId",
      "acceptedAt",
    ]) &&
    value["kind"] === "napier.subagent-hub-action-result" &&
    value["schemaVersion"] === 1 &&
    value["action"] === action &&
    value["sourceTaskId"] === sourceTaskId &&
    positiveInteger(value["sourceTaskRevision"]) &&
    resourceId(value["taskId"]) &&
    optionalResourceId(value["executionId"]) &&
    optionalResourceId(value["messageId"]) &&
    timestamp(value["acceptedAt"])
  );
}
