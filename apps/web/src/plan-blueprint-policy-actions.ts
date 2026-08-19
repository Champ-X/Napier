import {
  getExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  getExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
  retireExecutionPlanBlueprintRecommendationPolicyOverride,
  signExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle,
  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle,
  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
} from "./api";
import { formatApiErrorMessage } from "./api-error";
import type { PlanBlueprintLibraryCardActions } from "./PlanBlueprintLibraryCard";
import {
  firstSigningAnchor,
  signingAnchorAvailable,
} from "./plan-blueprint-panel-model";
import {
  planBlueprintRecommendationPolicyOverrideDriftReviewReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementHistoryReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementProofBundleReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementProofBundleSignedReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementReceipt,
} from "./plan-blueprint-library-view-model";
import type { PlanBlueprintLibraryActionContext } from "./plan-blueprint-library-controller-types";
import {
  patchBlueprintLibraryState,
  runBlueprintLibraryAction,
} from "./plan-blueprint-library-controller-types";
import {
  downloadPlanJson,
  MAX_PLAN_BLUEPRINT_POLICY_OVERRIDE_RETIREMENT_HISTORY_FILE_BYTES,
} from "./plan-panel-helpers";
import { planCopy } from "./plan-copy";
import { listReceiptTrustAnchors } from "./receipt-trust-api";

type PolicyActions = Pick<
  PlanBlueprintLibraryCardActions,
  | "onReviewPolicyOverrideDrift"
  | "onRetirePolicyOverride"
  | "onAuditPolicyOverrideRetirements"
  | "onVerifyPolicyOverrideRetirements"
  | "onVerifyPolicyOverrideRetirementProofBundle"
  | "onSignPolicyOverrideRetirementProofBundle"
>;

export function createPlanBlueprintPolicyActions(
  context: PlanBlueprintLibraryActionContext,
): PolicyActions {
  const onReviewPolicyOverrideDrift = (): void => {
    void runBlueprintLibraryAction(
      context,
      "reviewPolicyOverrideDrift",
      getExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
      (result) => ({
        receipt:
          planBlueprintRecommendationPolicyOverrideDriftReviewReceipt(result),
      }),
    );
  };

  const onRetirePolicyOverride = (): void => {
    const receipt = context.state.receipt;
    if (
      receipt?.action !== "policyOverrideDriftReviewed" ||
      receipt.reviewedRecommendation !== "retire" ||
      !receipt.reviewedFamilySha256 ||
      !receipt.reviewedOverrideSha256
    ) {
      return;
    }
    void runBlueprintLibraryAction(
      context,
      "retirePolicyOverride",
      () =>
        retireExecutionPlanBlueprintRecommendationPolicyOverride({
          familySha256: receipt.reviewedFamilySha256!,
          expectedOverrideSha256: receipt.reviewedOverrideSha256!,
          expectedOverrideSetSha256: receipt.overrideSetSha256,
          expectedDriftReviewSetSha256: receipt.reviewSetSha256,
          expectedPortfolioSetSha256: receipt.portfolioSetSha256,
        }),
      (result) => ({
        receipt:
          planBlueprintRecommendationPolicyOverrideRetirementReceipt(result),
      }),
      { preserveReceipt: true },
    );
  };

  const onAuditPolicyOverrideRetirements = (): void => {
    void runBlueprintLibraryAction(
      context,
      "auditPolicyOverrideRetirements",
      getExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
      (history) => {
        downloadPlanJson(
          history,
          `napier-blueprint-policy-override-retirements-${history.retirementSetSha256.slice(0, 12)}.json`,
        );
        return {
          receipt:
            planBlueprintRecommendationPolicyOverrideRetirementHistoryReceipt(
              history,
            ),
        };
      },
    );
  };

  const onVerifyPolicyOverrideRetirements = (file: File): void => {
    if (!filesWithinLimit([file])) {
      patchBlueprintLibraryState(context, {
        error:
          planCopy.blueprint.library.errors.policyOverrideRetirementsTooLarge,
      });
      return;
    }
    void runBlueprintLibraryAction(
      context,
      "verifyPolicyOverrideRetirements",
      async () =>
        verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements({
          history: JSON.parse(await file.text()) as unknown,
        }),
      (result) => ({
        receipt:
          planBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationReceipt(
            result,
          ),
      }),
      { formatError: formatRetirementFileError },
    );
  };

  const onVerifyPolicyOverrideRetirementProofBundle = (files: File[]): void => {
    if (!filesWithinLimit(files)) {
      patchBlueprintLibraryState(context, {
        error:
          planCopy.blueprint.library.errors.policyOverrideRetirementsTooLarge,
      });
      return;
    }
    void runBlueprintLibraryAction(
      context,
      "verifyPolicyOverrideRetirementProofBundle",
      async () =>
        verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
          { histories: await readJsonFiles(files) },
        ),
      (result) => ({
        receipt:
          planBlueprintRecommendationPolicyOverrideRetirementProofBundleReceipt(
            result,
          ),
      }),
      { formatError: formatRetirementFileError },
    );
  };

  const onSignPolicyOverrideRetirementProofBundle = (files: File[]): void => {
    if (!context.threadId || !filesWithinLimit(files)) {
      if (context.threadId) {
        patchBlueprintLibraryState(context, {
          error:
            planCopy.blueprint.library.errors.policyOverrideRetirementsTooLarge,
        });
      }
      return;
    }
    void runBlueprintLibraryAction(
      context,
      "signPolicyOverrideRetirementProofBundle",
      () => signProofBundle(context, files),
      ({ anchors, signerId, envelope }) => {
        downloadPlanJson(
          envelope,
          `napier-signed-policy-retirement-proof-bundle-${envelope.contentSha256.slice(0, 12)}.json`,
        );
        return {
          trustAnchors: anchors,
          selectedTrustAnchorId: signerId,
          receipt:
            planBlueprintRecommendationPolicyOverrideRetirementProofBundleSignedReceipt(
              envelope,
            ),
        };
      },
      { formatError: formatRetirementFileError },
    );
  };

  return {
    onReviewPolicyOverrideDrift,
    onRetirePolicyOverride,
    onAuditPolicyOverrideRetirements,
    onVerifyPolicyOverrideRetirements,
    onVerifyPolicyOverrideRetirementProofBundle,
    onSignPolicyOverrideRetirementProofBundle,
  };
}

async function signProofBundle(
  context: PlanBlueprintLibraryActionContext,
  files: File[],
) {
  const anchors = await listReceiptTrustAnchors();
  const signer = signingAnchorAvailable(
    anchors,
    context.state.selectedTrustAnchorId,
  )
    ? anchors.find(
        (anchor) => anchor.id === context.state.selectedTrustAnchorId,
      )
    : firstSigningAnchor(anchors);
  if (!signer) {
    patchBlueprintLibraryState(context, {
      trustAnchors: anchors,
      selectedTrustAnchorId: "",
    });
    throw new Error(
      planCopy.blueprint.library.errors.policyOverrideProofBundleNoSigner,
    );
  }
  const envelope =
    await signExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
      {
        histories: await readJsonFiles(files),
        threadId: context.threadId!,
        trustAnchorId: signer.id,
      },
    );
  return { anchors, signerId: signer.id, envelope };
}

function filesWithinLimit(files: File[]): boolean {
  return files.every(
    (file) =>
      file.size <=
      MAX_PLAN_BLUEPRINT_POLICY_OVERRIDE_RETIREMENT_HISTORY_FILE_BYTES,
  );
}

async function readJsonFiles(files: File[]): Promise<unknown[]> {
  return Promise.all(
    files.map(async (file) => JSON.parse(await file.text()) as unknown),
  );
}

function formatRetirementFileError(error: unknown): string {
  return error instanceof SyntaxError
    ? planCopy.blueprint.library.errors.policyOverrideRetirementsInvalid
    : formatApiErrorMessage(error);
}
