import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import type { SubagentWorkingSetCapsule } from "./subagent-working-set-capsule.js";
import type { SubagentWorkingSetBinding } from "./subagent-working-set-types.js";
import type { PreparedSubagentChildContinuation, SubagentChildContinuationAssessment,
  SubagentChildRestoreData, SubagentChildRestoreSource } from "./subagent-continuation-types.js";
import { assertSubagentRestoreWorkspace } from "./subagent-continuation-workspace.js";

export interface PreparedSubagentContinuationState {
  dataRoot: string;
  assessment: SubagentChildContinuationAssessment;
  sourceRun: RunRecord;
  sourceTask: SubagentTask;
  sourceParent: RunRecord;
  targetParent: RunRecord;
  capsule: SubagentWorkingSetCapsule;
  binding: SubagentWorkingSetBinding;
  sourceEvents: RunEvent[];
  mailbox: SubagentChildRestoreData["mailbox"];
}
const preparations = new WeakMap<object, PreparedSubagentContinuationState>();
const restorations = new WeakMap<object, { data: SubagentChildRestoreData; capsule: SubagentWorkingSetCapsule; events: RunEvent[] }>();

export function prepareSubagentContinuationSource(state: PreparedSubagentContinuationState): PreparedSubagentChildContinuation {
  const prepared = Object.freeze({}) as PreparedSubagentChildContinuation;
  preparations.set(prepared, structuredClone(state));
  return prepared;
}
export function resolvePreparedSubagentContinuation(prepared: PreparedSubagentChildContinuation): PreparedSubagentContinuationState {
  const state = preparations.get(prepared);
  if (!state) throw new Error("Child continuation requires validated private preparation authority");
  return structuredClone(state);
}
export function createSubagentChildRestore(data: SubagentChildRestoreData, source: PreparedSubagentContinuationState): SubagentChildRestoreSource {
  const restore = Object.freeze({}) as SubagentChildRestoreSource;
  restorations.set(restore, { data: structuredClone(data), capsule: structuredClone(source.capsule), events: structuredClone(source.sourceEvents) });
  return restore;
}
export function resolveSubagentChildRestore(restore: SubagentChildRestoreSource): SubagentChildRestoreData {
  const value = restorations.get(restore);
  if (!value) throw new Error("Child restore source requires committed continuation authority");
  return structuredClone(value.data);
}
export async function revalidateSubagentChildRestoreWorkspace(restore: SubagentChildRestoreSource, workspaceRoot: string): Promise<void> {
  const value = restorations.get(restore);
  if (!value) throw new Error("Child restore source requires committed continuation authority");
  await assertSubagentRestoreWorkspace(workspaceRoot, value.capsule, value.events);
}
