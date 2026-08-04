import type { LocalStore } from "./store.js";

export type BlueprintOutcomeReviewStorePort = Pick<
  LocalStore,
  | "getExecutionPlanBlueprintRecord"
  | "getExecutionPlanBlueprintRecordReplayOutcomes"
  | "qualifyExecutionPlanBlueprintRecord"
  | "qualifyExecutionPlanBlueprintRecordOutcomes"
>;

export type BlueprintOutcomeQualification = Awaited<
  ReturnType<
    BlueprintOutcomeReviewStorePort["qualifyExecutionPlanBlueprintRecordOutcomes"]
  >
>;
