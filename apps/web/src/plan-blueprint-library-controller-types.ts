import type { Dispatch, SetStateAction } from "react";

import type {
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ReceiptTrustAnchor,
} from "@napier/contracts";

import { formatApiErrorMessage } from "./api-error";
import type {
  PlanBlueprintLibraryBusyAction,
  PlanBlueprintLibraryReceipt,
} from "./plan-blueprint-library-panel-types";

export interface PlanBlueprintLibraryControllerState {
  records: ExecutionPlanBlueprintRecord[];
  loaded: boolean;
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  receipt: PlanBlueprintLibraryReceipt | undefined;
  outcomeReview: ExecutionPlanBlueprintRecordOutcomeReview | undefined;
  error: string | undefined;
  trustAnchors: ReceiptTrustAnchor[];
  selectedTrustAnchorId: string;
}

export interface PlanBlueprintLibraryActionContext {
  threadId: string | undefined;
  hasOpenPlan: boolean;
  verifiedBlueprint: ExecutionPlanBlueprint | undefined;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  state: PlanBlueprintLibraryControllerState;
  setState: Dispatch<SetStateAction<PlanBlueprintLibraryControllerState>>;
  onChanged: () => void | Promise<void>;
}

export const EMPTY_BLUEPRINT_LIBRARY_STATE: PlanBlueprintLibraryControllerState =
  {
    records: [],
    loaded: false,
    busyAction: undefined,
    receipt: undefined,
    outcomeReview: undefined,
    error: undefined,
    trustAnchors: [],
    selectedTrustAnchorId: "",
  };

export function patchBlueprintLibraryState(
  context: PlanBlueprintLibraryActionContext,
  patch:
    | Partial<PlanBlueprintLibraryControllerState>
    | ((
        state: PlanBlueprintLibraryControllerState,
      ) => Partial<PlanBlueprintLibraryControllerState>),
): void {
  context.setState((state) => ({
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  }));
}

export async function runBlueprintLibraryAction<T>(
  context: PlanBlueprintLibraryActionContext,
  busyAction: PlanBlueprintLibraryBusyAction,
  operation: () => Promise<T>,
  commit: (
    result: T,
  ) =>
    | Partial<PlanBlueprintLibraryControllerState>
    | Promise<Partial<PlanBlueprintLibraryControllerState>>,
  options: {
    preserveReceipt?: boolean;
    formatError?: (error: unknown) => string;
  } = {},
): Promise<void> {
  if (context.state.busyAction) return;
  patchBlueprintLibraryState(context, {
    busyAction,
    error: undefined,
    ...(options.preserveReceipt ? {} : { receipt: undefined }),
  });
  try {
    patchBlueprintLibraryState(context, await commit(await operation()));
  } catch (error) {
    patchBlueprintLibraryState(context, {
      error: (options.formatError ?? formatApiErrorMessage)(error),
    });
  } finally {
    patchBlueprintLibraryState(context, { busyAction: undefined });
  }
}
