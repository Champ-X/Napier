import { useEffect, useState } from "react";

import type { ExecutionPlanBlueprint } from "@napier/contracts";

import { getExecutionPlanBlueprintRecords } from "./api";
import { formatApiErrorMessage } from "./api-error";
import {
  type PlanBlueprintLibraryCardActions,
  type PlanBlueprintLibraryCardState,
} from "./PlanBlueprintLibraryCard";
import { createPlanBlueprintOutcomeActions } from "./plan-blueprint-outcome-actions";
import { createPlanBlueprintPolicyActions } from "./plan-blueprint-policy-actions";
import { createPlanBlueprintPortfolioActions } from "./plan-blueprint-portfolio-actions";
import { createPlanBlueprintRecordActions } from "./plan-blueprint-record-actions";
import {
  EMPTY_BLUEPRINT_LIBRARY_STATE,
  type PlanBlueprintLibraryActionContext,
  type PlanBlueprintLibraryControllerState,
} from "./plan-blueprint-library-controller-types";
import {
  firstSigningAnchor,
  signingAnchorAvailable,
} from "./plan-blueprint-panel-model";
import { listReceiptTrustAnchors } from "./receipt-trust-api";

export interface PlanBlueprintLibraryController {
  state: PlanBlueprintLibraryCardState;
  actions: PlanBlueprintLibraryCardActions;
}

export interface UsePlanBlueprintLibraryControllerOptions {
  threadId: string | undefined;
  verifiedBlueprint: ExecutionPlanBlueprint | undefined;
  hasOpenPlan: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onChanged: () => void | Promise<void>;
}

export function usePlanBlueprintLibraryController({
  threadId,
  verifiedBlueprint,
  hasOpenPlan,
  selectedModelKey,
  selectedModelConfigured,
  onChanged,
}: UsePlanBlueprintLibraryControllerOptions): PlanBlueprintLibraryController {
  const [controllerState, setControllerState] =
    useState<PlanBlueprintLibraryControllerState>(
      EMPTY_BLUEPRINT_LIBRARY_STATE,
    );

  useEffect(() => {
    let cancelled = false;
    setControllerState((state) => ({
      ...state,
      busyAction: "load",
      error: undefined,
    }));
    getExecutionPlanBlueprintRecords()
      .then((records) => {
        if (!cancelled) {
          setControllerState((state) => ({ ...state, records, loaded: true }));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setControllerState((state) => ({
            ...state,
            error: formatApiErrorMessage(error),
          }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setControllerState((state) => ({
            ...state,
            busyAction: undefined,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listReceiptTrustAnchors()
      .then((trustAnchors) => {
        if (cancelled) return;
        setControllerState((state) => ({
          ...state,
          trustAnchors,
          selectedTrustAnchorId: signingAnchorAvailable(
            trustAnchors,
            state.selectedTrustAnchorId,
          )
            ? state.selectedTrustAnchorId
            : (firstSigningAnchor(trustAnchors)?.id ?? ""),
        }));
      })
      .catch(() => {
        if (!cancelled) {
          setControllerState((state) => ({
            ...state,
            trustAnchors: [],
            selectedTrustAnchorId: "",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const context: PlanBlueprintLibraryActionContext = {
    threadId,
    hasOpenPlan,
    verifiedBlueprint,
    selectedModelKey,
    selectedModelConfigured,
    state: controllerState,
    setState: setControllerState,
    onChanged,
  };
  const actions: PlanBlueprintLibraryCardActions = {
    ...createPlanBlueprintRecordActions(context),
    ...createPlanBlueprintOutcomeActions(context),
    ...createPlanBlueprintPortfolioActions(context),
    ...createPlanBlueprintPolicyActions(context),
  };
  return {
    state: {
      records: controllerState.records,
      loaded: controllerState.loaded,
      hasVerifiedBlueprint: Boolean(verifiedBlueprint),
      canSave: Boolean(threadId && verifiedBlueprint),
      canSelect: Boolean(threadId),
      canSignPolicyOverrideRetirementProofBundle: Boolean(
        threadId && firstSigningAnchor(controllerState.trustAnchors),
      ),
      canCreateRecord: Boolean(threadId && !hasOpenPlan),
      busyAction: controllerState.busyAction,
      receipt: controllerState.receipt,
      latestOutcomeReview: controllerState.outcomeReview,
      error: controllerState.error,
      selectedModelConfigured,
    },
    actions,
  };
}
