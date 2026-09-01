import type { RunEvent } from "@napier/contracts";
import {
  isSkillLifecycleProjectionV1,
  type SkillApplicationMode,
  type SkillLifecycleProjectionState,
} from "@napier/contracts/skill-lifecycle";
import type {
  StandardSkillRootKind,
  StandardSkillSource,
} from "@napier/contracts/skill-load-standard";

export interface SkillLifecycleEventTraceView {
  skillName: string;
  state: SkillLifecycleProjectionState;
  source: StandardSkillSource | "composite";
  rootKind?: StandardSkillRootKind;
  candidateRootKinds: StandardSkillRootKind[];
  applicationMode?: SkillApplicationMode;
  proofEventCount: number;
  catalogSha256: string;
  receiptContentSha256?: string;
  failureContentSha256?: string;
  proofEventSetSha256?: string;
  projectionSha256: string;
}

export function skillLifecycleEventTraceView(
  event: RunEvent,
): SkillLifecycleEventTraceView | undefined {
  if (
    event.type !== "skill.lifecycle" ||
    !isSkillLifecycleProjectionV1(event.payload)
  ) {
    return undefined;
  }
  const value = event.payload;
  return {
    skillName: value.skillName,
    state: value.state,
    source: value.source,
    ...(value.rootKind ? { rootKind: value.rootKind } : {}),
    candidateRootKinds: value.candidateRootKinds,
    ...(value.applicationMode
      ? { applicationMode: value.applicationMode }
      : {}),
    proofEventCount: value.proofEventSeqs?.length ?? 0,
    catalogSha256: value.catalogSha256,
    ...(value.receiptContentSha256
      ? { receiptContentSha256: value.receiptContentSha256 }
      : {}),
    ...(value.failureContentSha256
      ? { failureContentSha256: value.failureContentSha256 }
      : {}),
    ...(value.proofEventSetSha256
      ? { proofEventSetSha256: value.proofEventSetSha256 }
      : {}),
    projectionSha256: value.contentSha256,
  };
}

export function skillLifecycleEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (event.type !== "skill.lifecycle") return undefined;
  const view = skillLifecycleEventTraceView(event);
  if (!view) return "skill lifecycle receipt";
  return [
    `skill / ${view.skillName}`,
    `state ${view.state}`,
    `source ${view.source}`,
    ...(view.rootKind ? [`root ${view.rootKind}`] : []),
    ...(view.candidateRootKinds.length
      ? [`candidates ${view.candidateRootKinds.join(",")}`]
      : []),
    ...(view.applicationMode ? [`proof ${view.applicationMode}`] : []),
    ...(view.proofEventCount > 0
      ? [`proof-events ${view.proofEventCount}`]
      : []),
    `projection ${view.projectionSha256.slice(0, 12)}`,
  ].join(" / ");
}
