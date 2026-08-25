import type { LocalStore } from "@napier/runtime/store";

export type ThreadWorkflowHttpStore = Pick<
  LocalStore,
  "getDetail" | "getThread"
>;
