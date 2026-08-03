import type { LocalStore } from "@napier/runtime";

export type ThreadWorkflowHttpStore = Pick<
  LocalStore,
  "getDetail" | "getThread"
>;
