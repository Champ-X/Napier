import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
HealthResponse,
ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult,
ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
ReceiptTrustAnchorDirectoryDiscovery,
ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
ReceiptTrustAnchorDirectoryQuorumMetadataEvidence,
SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
TrustedReceiptVerification
} from "@napier/contracts";
import { createEvaluationCasebookQualificationReceipt, createEvaluationSuiteGateReceipt } from "@napier/runtime/evaluation";
import { builtinUsagePriceTableCatalog, verifyUsagePriceTableCatalog } from "@napier/runtime/model";
import {
  createReceiptTrustAnchorDirectoryMetadataReceipt,
  createReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt,
  createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment,
  createReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_BYTES,
  MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES,
  MAX_EXTENSION_PACKAGE_LOCKFILE_BYTES,
  MAX_SIGNED_EXTENSION_PACKAGE_BYTES,
  MAX_SIGNED_INSPECTOR_PACKAGE_BYTES,
  MAX_SIGNED_PROMPT_PACKAGE_BYTES,
  MAX_SIGNED_SKILL_PACKAGE_BYTES,
  MAX_SKILL_CONTENT_BYTES,
  MAX_TRUSTED_RECEIPT_BYTES,
  receiptTrustAnchorsFromDirectory,
  reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  signTrustedReceipt,
  verifyReceiptTrustAnchorDirectoryMetadata,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  verifySignedExtensionPackageEnvelope,
  verifyTrustedReceiptEnvelope,
} from "@napier/runtime/governance";
import { MAX_THREAD_REPLAY_BUNDLE_BYTES } from "@napier/runtime/agent";
import { MAX_EXECUTION_PLAN_BLUEPRINT_BYTES } from "@napier/runtime/workflow";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { registerAgentProfileHttp } from "./agent-profile-http.js";
import { createHealthCompatibilityProjection,createHealthRuntimeProjection,isExtensionPackageClientError,isExtensionPackageConflict,isPlanClientError,isPlanConflict,isReceiptTrustClientError,isReceiptTrustConflict,isSkillContentClientError,isSkillContentConflict,isSkillPackageConflict,setEvaluationSuiteExecutionListHeaders,setEvaluationSuiteGateReceiptHeaders,setEvaluationSuiteListHeaders,setExecutionPlanBlueprintPortfolioCalibrationHeaders,setExecutionPlanBlueprintRecommendationPolicyBacktestHeaders,setExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewHeaders,setExecutionPlanBlueprintRecommendationPolicyOverrideHeaders,setExecutionPlanBlueprintRecommendationPolicyOverrideListHeaders,setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHeaders,setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryHeaders,setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleHeaders,setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationHeaders,setExtensionListHeaders,setExtensionRecordHeaders,setHealthProjectionHeaders,setWorkspaceProcessProjectionHeaders } from "./app-http-response-core.js";
import { MAX_EVALUATION_REQUEST_BYTES,MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES,MAX_TRUST_ADMIN_REQUEST_BYTES,parseRetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,parseSetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,parseSignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest,parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest,parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest,parseVerifyUsagePriceTableCatalogRequest } from "./app-http-validation-core.js";
import { registerBootstrapHttp } from "./bootstrap-http.js";
import { registerReleaseEvidenceHttp } from "./controlled-harness-evidence-http.js";
import { registerCredentialHttp } from "./credential-http.js";
import { setEvaluationCasebookProjectionHeaders } from "./evaluation-admin-http-response.js";
import { registerEvaluationCasebookAdminHttp } from "./evaluation-casebook-admin-http.js";
import { registerEvaluationCatalogHttp } from "./evaluation-catalog-http.js";
import { setEvaluationCasebookArtifactHeaders,setEvaluationCasebookCalibrationHeaders,setEvaluationCasebookListHeaders,setEvaluationCasebookQualificationListHeaders,setEvaluationCasebookQualificationReceiptHeaders,setEvaluationQualificationBaselineListHeaders,setPromoteEvaluationQualificationBaselineResultHeaders } from "./evaluation-http-evidence.js";
import { registerEvaluationReviewHttp } from "./evaluation-review-http.js";
import { registerEvaluationSuiteAdminHttp } from "./evaluation-suite-admin-http.js";
import { registerExtensionLifecycleHttp } from "./extension-lifecycle-http.js";
import { readLimitedJson,RequestBodyTooLargeError } from "./http-request-body.js";
import { registerLoopbackApiGuard,requestRecord } from "./http-request-validation.js";
import { errorMessage,jsonError,sha256Json } from "./http-response-evidence.js";
import { registerInboundChannelAdminHttp } from "./inbound-channel-admin-http.js";
import { registerInboundChannelDeadLetterHttp } from "./inbound-channel-dead-letter-http.js";
import { registerInboundChannelDeliveryHttp } from "./inbound-channel-delivery-http.js";
import { registerInboundChannelIngressHttp } from "./inbound-channel-ingress-http.js";
import { registerMemoryHttp } from "./memory-http.js";
import { setExtensionPublisherTrustAnchorHeaders,setExtensionPublisherTrustAnchorListHeaders,setInspectorPackageHeaders,setPromptPackageHeaders,setPromptPackageQualificationHeaders,setPromptPackageVerificationHeaders,setSignedExtensionPackageHeaders,setSkillContentApplyResultHeaders,setSkillContentReviewHeaders,setSkillPackageHeaders,setSkillPackageInstallationListHeaders,setSkillPackageInstallationResultHeaders,setSkillPackageQualificationHeaders,setSkillPackageVerificationHeaders,setTrustedReceiptHeaders,setTrustedReceiptVerificationHeaders,setUsagePriceTableCatalogHeaders,setUsagePriceTableVerificationHeaders,signedExtensionPackageEventPayload,trustedReceiptEventPayload } from "./package-governance-http-evidence-core.js";
import { appendExtensionEvent,appendReceiptTrustEvent,setExtensionPackageChannelIndexHeaders,setExtensionPackageChannelIndexVerificationHeaders,setExtensionPackageDeploymentPreviewHeaders,setExtensionPackageDeploymentResultHeaders,setExtensionPackageLockfileHeaders,setExtensionPackageLockfileVerificationHeaders,setExtensionPackageRolloutApplyResultHeaders,setExtensionPackageRolloutChannelHeaders,setExtensionPackageRolloutChannelListHeaders,setExtensionPackageRolloutPreviewHeaders,setExtensionPackageUpdatePreviewHeaders,setExtensionPackageUpdateResultHeaders,setExtensionPackageVerificationHeaders,setInspectorPackageQualificationHeaders,setInspectorPackageVerificationHeaders } from "./package-governance-http-evidence-distribution.js";
import { parseApplyExtensionPackageDeploymentRequest,parseApplyExtensionPackageRolloutChannelRequest,parseApplyExtensionPackageUpdateRequest,parseApplySkillContentRequest,parseCreateExtensionPublisherTrustAnchorRequest,parseExportExtensionPackageLockfileRequest,parseImportSignedExtensionPackageRequest,parseInstallSkillPackageRequest,parsePreviewExtensionPackageDeploymentRequest,parsePreviewExtensionPackageRolloutChannelRequest,parsePreviewExtensionPackageUpdateRequest,parsePreviewSkillContentRequest,parsePublishExtensionPackageRolloutChannelRequest,parseQualifyInspectorPackageRequest,parseQualifyPromptPackageRequest,parseQualifySkillPackageRequest,parseRevokeExtensionPublisherTrustAnchorRequest,parseSignExtensionPackageChannelIndexRequest,parseSignExtensionPackageRequest,parseSignInspectorPackageRequest,parseSignPromptPackageRequest,parseSignSkillPackageRequest,parseVerifyExtensionPackageChannelIndexRequest,parseVerifyExtensionPackageLockfileRequest,parseVerifyInspectorPackageRequest,parseVerifyPromptPackageRequest,parseVerifySignedExtensionPackageRequest,parseVerifySkillPackageRequest } from "./package-governance-http-validation.js";
import { registerPlanArtifactDataHttp } from "./plan-artifact-data-http.js";
import { registerPlanArtifactDirectoryHttp } from "./plan-artifact-directory-http.js";
import { registerPlanArtifactFileHttp } from "./plan-artifact-file-http.js";
import { registerPlanArtifactInspectionHttp } from "./plan-artifact-inspection-http.js";
import { registerPlanBlueprintInstantiationHttp } from "./plan-blueprint-instantiation-http.js";
import { registerPlanBlueprintLibraryHttp } from "./plan-blueprint-library-http.js";
import { registerPlanBlueprintOutcomeHttp } from "./plan-blueprint-outcome-http.js";
import { registerPlanBlueprintReplayHttp } from "./plan-blueprint-replay-http.js";
import { registerPlanLifecycleHttp } from "./plan-lifecycle-http.js";
import { registerPlanProgressHttp } from "./plan-progress-http.js";
import { ReceiptTrustAnchorDirectoryDiscoveryError } from "./receipt-trust-directory-discovery.js";
import { createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery as createHostedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery } from "./receipt-trust-directory-subscriptions.js";
import { setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders,setImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders,setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders,setPromoteReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders,setReceiptTrustAnchorDirectoryHeaders,setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryHeaders,setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerificationHeaders,setReceiptTrustAnchorDirectoryQuorumActivationDecisionResultHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAuditHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReviewHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionStateHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineListHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerificationHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionListHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerificationHeaders,setReceiptTrustAnchorDirectoryQuorumHeaders,setReceiptTrustAnchorDirectoryQuorumPromotionBaselineListHeaders,setReceiptTrustAnchorDirectoryQuorumPromotionHeaders,setReceiptTrustAnchorListHeaders } from "./receipt-trust-http-evidence-core.js";
import { setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionApprovalResultHeaders,setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResultHeaders,setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders,setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders,setQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders,setReceiptTrustAnchorDirectoryDiscoveryHeaders,setReceiptTrustAnchorDirectoryMetadataVerificationHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflightHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplayHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineListHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerificationHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionListHeaders,setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshHeaders,setReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerificationHeaders,setReceiptTrustAnchorDirectorySubscriptionHeaders,setReceiptTrustAnchorDirectorySubscriptionListHeaders,setReceiptTrustAnchorDirectorySubscriptionRefreshHeaders,setReceiptTrustAnchorDirectoryVerificationHeaders,setReceiptTrustAnchorHeaders } from "./receipt-trust-http-evidence-rotation.js";
import { parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest,parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest,parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,parseCreateReceiptTrustAnchorRequest,parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest,parsePromoteEvaluationQualificationBaselineRequest,parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest,parseQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest,parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest,parseRevokeReceiptTrustAnchorRequest,parseSignReceiptTrustAnchorDirectoryMetadataRequest,parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,parseSignTrustedReceiptRequest,parseVerifyReceiptTrustAnchorDirectoryMetadataRequest,parseVerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest,parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest,parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest,parseVerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest,parseVerifyTrustedReceiptRequest } from "./receipt-trust-http-validation-core.js";
import { parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,parseDiscoverReceiptTrustAnchorDirectoryRequest,parseEvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest,parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,parseImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest,parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,parseProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest,parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest,parseSignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest,parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest,parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest,parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest,parseVerifyReceiptTrustAnchorDirectoryRequest } from "./receipt-trust-http-validation-rotation.js";
import { createReceiptTrustAnchorDirectoryQuorumMetadataEvidence,parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,parseCreateReceiptTrustAnchorDirectorySubscriptionRequest,parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest,parsePromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest,parsePromoteReceiptTrustAnchorDirectoryQuorumRequest,parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,parseRefreshReceiptTrustAnchorDirectorySubscriptionRequest,parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,parseUpdateReceiptTrustAnchorDirectorySubscriptionRequest } from "./receipt-trust-http-validation-subscriptions.js";
import {
createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay,
createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyQueueResult,
createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult,
createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalGate,
verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyGate,
verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineGate
} from "./receipt-trust-rotation-proposals.js";
import { registerRecentWorkspacesHttp,type ListWorkspaceThreads } from "./recent-workspaces.js";
import { registerRunEvaluationHttp } from "./run-evaluation-http.js";
import { registerScheduleHttp } from "./schedule-http.js";
import type { NapierServices } from "./server-composition-root.js";
import { registerThreadControlHttp } from "./thread-control-http.js";
import { registerThreadEvaluationHttp } from "./thread-evaluation-http.js";
import { registerThreadEvidenceHttp } from "./thread-evidence-http.js";
import { registerThreadExecutionHttp } from "./thread-execution-http.js";
import { registerThreadLifecycleHttp } from "./thread-lifecycle-http.js";
import { registerThreadOperationsHttp } from "./thread-operations-http.js";
import { registerThreadWorkflowHttp } from "./thread-workflow-http.js";
import { registerWorkspaceProcessHttp } from "./workspace-process-http.js";
import { registerWorkspaceRootHttp,type RebindWorkspace } from "./workspace-root-http.js";

export { createServices } from "./server-composition-root.js";
export type { NapierServices } from "./server-composition-root.js";
export { inferWorkspaceRoot } from "./workspace-root.js";
interface CreateAppOptions {
  rebindWorkspace?: RebindWorkspace;
  listWorkspaceThreads?: ListWorkspaceThreads;
}
export function createApp(services: NapierServices, options?: CreateAppOptions): Hono {
  const app = new Hono(); registerLoopbackApiGuard(app);
  app.use(
    "/api/*",
    cors({
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      allowHeaders: ["Content-Type", "Authorization", "X-Napier-Channel-Token", "X-Napier-Intent"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: false,
    }),
  );

  app.get("/api/health", (context) => {
    const persistence = services.store.getPersistenceMetrics();
    const response: HealthResponse = {
      status: persistence.last?.status === "failed" || (persistence.last?.projectionFailureCount ?? 0) > 0 ? "degraded" : "ok",
      service: "napier",
      time: new Date().toISOString(),
      runtime: createHealthRuntimeProjection(),
      ledger: services.store.getLedgerSchemaReport(),
      store: { persistence }, compatibility: createHealthCompatibilityProjection(),
    };
    setHealthProjectionHeaders(context, response);
    return context.json(response);
  });

  app.get("/api/receipt-trust/anchors", (context) => {
    const anchors = services.store.listReceiptTrustAnchors();
    setReceiptTrustAnchorListHeaders(context, anchors);
    return context.json(anchors);
  });

  app.get("/api/receipt-trust/anchors/directory", (context) => {
    const directory = services.store.getReceiptTrustAnchorDirectory();
    setReceiptTrustAnchorDirectoryHeaders(context, directory);
    return context.json(directory);
  });

  app.post("/api/receipt-trust/anchors/directory/signed-metadata", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory metadata signing request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory metadata signing request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseSignReceiptTrustAnchorDirectoryMetadataRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory metadata signing request is invalid", 400);
    }
    services.store.getThread(body.threadId);
    const directory = services.store.getReceiptTrustAnchorDirectory();
    const receipt = createReceiptTrustAnchorDirectoryMetadataReceipt(directory, body);
    const envelope = signTrustedReceipt(receipt, services.store.getReceiptTrustAnchor(body.trustAnchorId));
    await appendReceiptTrustEvent(services, body.threadId, "receipt.signed", {
      ...trustedReceiptEventPayload(envelope),
      publisher: receipt.publisher,
      directorySha256: receipt.directorySha256,
      anchorSetSha256: receipt.anchorSetSha256,
      ...(receipt.sourceUrlSha256 ? { sourceUrlSha256: receipt.sourceUrlSha256 } : {}),
      ...(receipt.sourceOriginSha256 ? { sourceOriginSha256: receipt.sourceOriginSha256 } : {}),
    });
    setTrustedReceiptHeaders(context, envelope, `napier-signed-anchor-directory-metadata-${directory.anchorSetSha256.slice(0, 12)}-${envelope.contentSha256.slice(0, 12)}.json`);
    return context.json(envelope, 201);
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions", (context) => {
    const subscriptions = services.store.listReceiptTrustAnchorDirectorySubscriptions();
    setReceiptTrustAnchorDirectorySubscriptionListHeaders(context, subscriptions);
    return context.json(subscriptions);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseEvaluateReceiptTrustAnchorDirectoryQuorumRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum request is invalid", 400);
    }
    let metadataEvidence: ReceiptTrustAnchorDirectoryQuorumMetadataEvidence[];
    try {
      metadataEvidence = createReceiptTrustAnchorDirectoryQuorumMetadataEvidence(services, body);
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const quorum = services.store.getReceiptTrustAnchorDirectorySubscriptionQuorum(body.policy, metadataEvidence);
    setReceiptTrustAnchorDirectoryQuorumHeaders(context, quorum);
    return context.json(quorum);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum promotion request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum promotion request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parsePromoteReceiptTrustAnchorDirectoryQuorumRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum promotion request is invalid", 400);
    }
    try {
      const metadataEvidence = createReceiptTrustAnchorDirectoryQuorumMetadataEvidence(services, body);
      const quorum = services.store.getReceiptTrustAnchorDirectorySubscriptionQuorum(body.policy, metadataEvidence);
      const promotion = createReceiptTrustAnchorDirectoryQuorumPromotionReceipt(quorum, body.metadata ?? []);
      setReceiptTrustAnchorDirectoryQuorumPromotionHeaders(context, promotion);
      return context.json(promotion, 201);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("requires an agreed quorum") ? 409 : 400);
    }
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines", (context) => {
    const baselines = services.store.listReceiptTrustAnchorDirectoryQuorumPromotionBaselines();
    setReceiptTrustAnchorDirectoryQuorumPromotionBaselineListHeaders(context, baselines);
    return context.json(baselines);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum promotion baseline request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum promotion baseline request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parsePromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum promotion baseline request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const metadataEvidence = createReceiptTrustAnchorDirectoryQuorumMetadataEvidence(services, body);
      const quorum = services.store.getReceiptTrustAnchorDirectorySubscriptionQuorum(body.policy, metadataEvidence);
      const promotion = createReceiptTrustAnchorDirectoryQuorumPromotionReceipt(quorum, body.metadata ?? []);
      const envelope = signTrustedReceipt(promotion, services.store.getReceiptTrustAnchor(body.trustAnchorId));
      const result = await services.store.promoteReceiptTrustAnchorDirectoryQuorumPromotionBaseline(body.threadId, envelope);
      if (result.created) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt_trust.directory_quorum_promotion_baseline.promoted", {
          ...trustedReceiptEventPayload(envelope),
          baselineId: result.baseline.id,
          baselineSha256: result.baseline.contentSha256,
          selectedAnchorSetSha256: result.baseline.selectedAnchorSetSha256,
          selectedDirectorySha256: result.baseline.selectedDirectorySha256,
          selectedSubscriptionSetSha256: result.baseline.selectedSubscriptionSetSha256,
          selectedMetadataEnvelopeSetSha256: result.baseline.selectedMetadataEnvelopeSetSha256,
        });
      }
      setPromoteReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders(context, result);
      return context.json(result, result.created ? 201 : 200);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("requires an agreed quorum") || message.includes("not trusted") ? 409 : 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum promotion baseline verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum promotion baseline verification request is invalid", 400);
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum promotion baseline verification request is invalid", 400);
    }
    const trustDirectoryVerification = body.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(body.trustDirectory, body.trustDirectoryPolicy);
    const anchors = body.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(body.trustDirectory) : [];
    const verification = verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(body.baseline, anchors, {
      ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
    });
    setReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum promotion baseline import request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum promotion baseline import request is invalid", 400);
    }
    const body = parseImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum promotion baseline import request is invalid", 400);
    }
    const trustDirectoryVerification = body.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(body.trustDirectory, body.trustDirectoryPolicy);
    const anchors = body.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(body.trustDirectory) : [];
    const verification = verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(body.baseline, anchors, {
      ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
    });
    if (verification.status !== "trusted" || !verification.baselineValid || !verification.signatureValid || !verification.integrityValid) {
      return jsonError(context, "Receipt trust anchor directory quorum promotion baseline import requires trusted verification", 409);
    }
    try {
      const imported = await services.store.importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(body.threadId, body.baseline, body.expectedCurrentBaselineSha256, anchors, body.importPolicy);
      if (imported.imported) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt_trust.directory_quorum_promotion_baseline.imported", {
          baselineId: imported.baseline.id,
          baselineSha256: imported.baseline.contentSha256,
          importedReceiptSha256: imported.baseline.envelope.receipt.contentSha256,
          envelopeSha256: imported.baseline.envelope.contentSha256,
          keyId: imported.baseline.envelope.signature.keyId,
          expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
          ...(imported.previousBaselineSha256 ? { previousBaselineSha256: imported.previousBaselineSha256 } : {}),
          verificationSha256: verification.contentSha256,
          ...(imported.policyReview
            ? {
                importPolicySha256: imported.policyReview.policySha256,
                importPolicyReviewSha256: imported.policyReview.contentSha256,
              }
            : {}),
        });
      }
      const result: ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult = {
        baseline: imported.baseline,
        imported: imported.imported,
        verification,
        ...(imported.policyReview ? { policyReview: imported.policyReview } : {}),
        expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
        ...(imported.previousBaselineSha256 ? { previousBaselineSha256: imported.previousBaselineSha256 } : {}),
      };
      setImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders(context, result);
      return context.json(result, imported.imported ? 201 : 200);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("precondition") || message.includes("policy rejected") ? 409 : 400);
    }
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions", (context) => {
    const history = services.store.getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory();
    setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryHeaders(context, history);
    return context.json(history);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation decision history verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation decision history verification request is invalid", 400);
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation decision history verification request is invalid", 400);
    }
    const verification = services.store.verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(body.history);
    setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection", (context) => {
    const state = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionStateHeaders(context, state);
    return context.json(state);
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit", (context) => {
    const audit = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit();
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAuditHeaders(context, audit);
    return context.json(audit);
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint", (context) => {
    const checkpoint = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointHeaders(context, checkpoint);
    return context.json(checkpoint);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection transparency checkpoint verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint verification request is invalid", 400);
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint verification request is invalid", 400);
    }
    const verification = services.store.verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(body.checkpoint);
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/discover", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection transparency checkpoint discovery request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint discovery request is invalid", 400);
    }
    const body = parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint discovery request is invalid", 400);
    }
    try {
      const source = await services.receiptTrustDirectories.fetchJson(body.sourceUrl);
      const discovery = createHostedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(services.store, source, body);
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryHeaders(context, discovery);
      return context.json(discovery, discovery.status === "valid" ? 200 : 422);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint discovery failed", error instanceof ReceiptTrustAnchorDirectoryDiscoveryError ? error.status : message.includes("checkpoint") ? 422 : 400);
    }
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions", (context) => {
    const subscriptions = services.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions();
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionListHeaders(context, subscriptions);
    return context.json(subscriptions);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseEvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum request is invalid", 400);
    }
    const quorum = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(body.policy);
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumHeaders(context, quorum);
    return context.json(quorum);
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines", (context) => {
    const baselines = services.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines();
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineListHeaders(context, baselines);
    return context.json(baselines);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum baseline request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum baseline request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint registry quorum baseline request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const quorum = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(body.policy);
      const envelope = signTrustedReceipt(quorum, services.store.getReceiptTrustAnchor(body.trustAnchorId));
      const result = await services.store.promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(body.threadId, envelope);
      if (result.created) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt_trust.checkpoint_registry_quorum_baseline.promoted", {
          ...trustedReceiptEventPayload(envelope),
          baselineId: result.baseline.id,
          baselineSha256: result.baseline.contentSha256,
          selectedCheckpointSha256: result.baseline.selectedCheckpointSha256,
          selectedSelectionSetSha256: result.baseline.selectedSelectionSetSha256,
          selectedSelectionChainTailSha256: result.baseline.selectedSelectionChainTailSha256 ?? "",
          selectedSubscriptionSetSha256: result.baseline.selectedSubscriptionSetSha256,
          selectedSourceOriginSetSha256: result.baseline.selectedSourceOriginSetSha256,
          selectedSignerSetSha256: result.baseline.selectedSignerSetSha256,
        });
      }
      setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders(context, result);
      return context.json(result, result.created ? 201 : 200);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("requires an agreed quorum") || message.includes("not trusted") ? 409 : 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust checkpoint registry quorum baseline verification request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust checkpoint registry quorum baseline verification request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust checkpoint registry quorum baseline verification request is invalid", 400);
    }
    const trustDirectoryVerification = body.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(body.trustDirectory, body.trustDirectoryPolicy);
    const anchors = body.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(body.trustDirectory) : [];
    const verification = verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(body.baseline, anchors, {
      ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
    });
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/import", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust checkpoint registry quorum baseline import request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust checkpoint registry quorum baseline import request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust checkpoint registry quorum baseline import request is invalid", 400);
    }
    const trustDirectoryVerification = body.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(body.trustDirectory, body.trustDirectoryPolicy);
    const anchors = body.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(body.trustDirectory) : [];
    const verification = verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(body.baseline, anchors, {
      ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
    });
    if (verification.status !== "trusted" || !verification.baselineValid || !verification.signatureValid || !verification.integrityValid) {
      return jsonError(context, "Receipt trust checkpoint registry quorum baseline import requires trusted verification", 409);
    }
    try {
      const imported = await services.store.importReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(body.threadId, body.baseline, body.expectedCurrentBaselineSha256, anchors);
      if (imported.imported) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt_trust.checkpoint_registry_quorum_baseline.imported", {
          baselineId: imported.baseline.id,
          baselineSha256: imported.baseline.contentSha256,
          expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
          previousBaselineSha256: imported.previousBaselineSha256 ?? "",
          verificationSha256: verification.contentSha256,
          envelopeSha256: imported.baseline.envelope.contentSha256,
          selectedCheckpointSha256: imported.baseline.selectedCheckpointSha256,
          selectedSelectionSetSha256: imported.baseline.selectedSelectionSetSha256,
          selectedSelectionChainTailSha256: imported.baseline.selectedSelectionChainTailSha256 ?? "",
          selectedSubscriptionSetSha256: imported.baseline.selectedSubscriptionSetSha256,
          selectedSourceOriginSetSha256: imported.baseline.selectedSourceOriginSetSha256,
          selectedSignerSetSha256: imported.baseline.selectedSignerSetSha256,
        });
      }
      const result: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult = {
        baseline: imported.baseline,
        imported: imported.imported,
        verification,
        expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
        ...(imported.previousBaselineSha256 ? { previousBaselineSha256: imported.previousBaselineSha256 } : {}),
      };
      setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders(context, result);
      return context.json(result, imported.imported ? 201 : 200);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("precondition failed") || message.includes("not trusted") ? 409 : 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription request is invalid", 400);
    }
    let discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
    try {
      const source = await services.receiptTrustDirectories.fetchJson(body.sourceUrl);
      discovery = createHostedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery(services.store, source, {
        sourceUrl: body.sourceUrl,
        policy: body.policy,
      });
    } catch (error) {
      if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription discovery failed", 502);
    }
    if (discovery.status !== "valid") {
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryHeaders(context, discovery);
      return context.json(discovery, 422);
    }
    const subscription = await services.store.createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(body, discovery);
    await appendReceiptTrustEvent(services, subscription.auditThreadId, "receipt.trust_checkpoint_subscription.created", {
      subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256,
      policySha256: subscription.policySha256,
      envelopeSha256: subscription.lastGoodDiscovery?.envelopeSha256 ?? "",
      checkpointSha256: subscription.lastGoodDiscovery?.checkpointSha256 ?? "",
      selectionCount: subscription.lastGoodDiscovery?.selectionCount ?? 0,
      selectionChainTailSha256: subscription.lastGoodDiscovery?.selectionChainTailSha256 ?? "",
    });
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionHeaders(context, subscription);
    return context.json(subscription, 201);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/:subscriptionId/refresh", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription refresh request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription refresh request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription refresh request is invalid", 400);
    }
    const result = await services.receiptTrustDirectorySubscriptions.refreshCheckpoint(context.req.param("subscriptionId"), body.threadId, body.expectedRevision);
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshHeaders(context, result);
    return context.json(result);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/:subscriptionId", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription update request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription update request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint subscription update request is invalid", 400);
    }
    const before = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(context.req.param("subscriptionId"));
    const subscription = await services.store.updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(before.id, body);
    if (before.revision !== subscription.revision) {
      await appendReceiptTrustEvent(services, subscription.auditThreadId, "receipt.trust_checkpoint_subscription.updated", {
        subscriptionId: subscription.id,
        subscriptionRevision: subscription.revision,
        subscriptionSha256: subscription.contentSha256,
        sourceUrlSha256: subscription.sourceUrlSha256,
        sourceOriginSha256: subscription.sourceOriginSha256,
        status: subscription.status,
      });
    }
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionHeaders(context, subscription);
    return context.json(subscription);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection transparency checkpoint signing request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint signing request is invalid", 400);
    }
    const body = parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection transparency checkpoint signing request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const checkpoint = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
      const envelope = signTrustedReceipt(checkpoint, services.store.getReceiptTrustAnchor(body.trustAnchorId));
      await appendReceiptTrustEvent(services, body.threadId, "receipt.signed", {
        ...trustedReceiptEventPayload(envelope),
        checkpointSha256: checkpoint.contentSha256,
        selectionCount: checkpoint.selectionCount,
        selectionSetSha256: checkpoint.selectionSetSha256,
        ...(checkpoint.selectionChainTailSha256
          ? {
              selectionChainTailSha256: checkpoint.selectionChainTailSha256,
            }
          : {}),
        driftStatus: checkpoint.driftStatus,
      });
      setTrustedReceiptHeaders(context, envelope, `napier-signed-quorum-activation-selection-checkpoint-${envelope.contentSha256.slice(0, 12)}.json`);
      return context.json(envelope, 201);
    } catch (error) {
      const message = errorMessage(error);
      const caught = error instanceof Error ? error : new Error(message);
      return jsonError(context, message, isReceiptTrustConflict(caught) ? 409 : 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation review request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation review request is invalid", 400);
    }
    const body = parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation review request is invalid", 400);
    }
    const review = services.store.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(body.activationDecisionRecordId, body.expectedCurrentSelectionSha256, body.checkpointRegistryQuorumPolicy);
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReviewHeaders(context, review);
    return context.json(review);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal request is invalid", 400);
    }
    const body = parseProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal request is invalid", 400);
    }
    const proposal = services.store.proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(body.activationDecisionRecordId, body.expectedCurrentSelectionSha256, {
      ...(body.checkpointRegistryQuorumBaselineId
        ? {
            checkpointRegistryQuorumBaselineId: body.checkpointRegistryQuorumBaselineId,
          }
        : {}),
      ...(body.expectedCheckpointRegistryQuorumBaselineSha256
        ? {
            expectedCheckpointRegistryQuorumBaselineSha256: body.expectedCheckpointRegistryQuorumBaselineSha256,
          }
        : {}),
      ...(body.checkpointRegistryQuorumPolicy
        ? {
            checkpointRegistryQuorumPolicy: body.checkpointRegistryQuorumPolicy,
          }
        : {}),
    });
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalHeaders(context, proposal);
    return context.json(proposal);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal signing request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal signing request is invalid", 400);
    }
    const body = parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal signing request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const proposal = services.store.proposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(body.activationDecisionRecordId, body.expectedCurrentSelectionSha256, {
        ...(body.checkpointRegistryQuorumBaselineId
          ? {
              checkpointRegistryQuorumBaselineId: body.checkpointRegistryQuorumBaselineId,
            }
          : {}),
        ...(body.expectedCheckpointRegistryQuorumBaselineSha256
          ? {
              expectedCheckpointRegistryQuorumBaselineSha256: body.expectedCheckpointRegistryQuorumBaselineSha256,
            }
          : {}),
        ...(body.checkpointRegistryQuorumPolicy
          ? {
              checkpointRegistryQuorumPolicy: body.checkpointRegistryQuorumPolicy,
            }
          : {}),
      });
      if (proposal.status !== "proposed") {
        return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal is not eligible for signing", 409);
      }
      const envelope = signTrustedReceipt(proposal, services.store.getReceiptTrustAnchor(body.trustAnchorId));
      await appendReceiptTrustEvent(services, body.threadId, "receipt.signed", {
        ...trustedReceiptEventPayload(envelope),
        proposalSha256: proposal.contentSha256,
        rotationReviewSha256: proposal.rotationReviewSha256,
        activationDecisionRecordId: proposal.activationDecisionRecordId,
        ...(proposal.activationDecisionRecordSha256
          ? {
              activationDecisionRecordSha256: proposal.activationDecisionRecordSha256,
            }
          : {}),
        expectedCurrentSelectionSha256: proposal.expectedCurrentSelectionSha256,
        currentSelectionSha256: proposal.currentSelectionSha256,
        ...(proposal.checkpointRegistryQuorumBaselineSha256
          ? {
              checkpointRegistryQuorumBaselineSha256: proposal.checkpointRegistryQuorumBaselineSha256,
            }
          : {}),
        currentCheckpointSha256: proposal.currentCheckpointSha256,
      });
      setTrustedReceiptHeaders(context, envelope, `napier-signed-quorum-activation-selection-rotation-proposal-${envelope.contentSha256.slice(0, 12)}.json`);
      return context.json(envelope, 201);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/discover", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal discovery request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal discovery request is invalid", 400);
    }
    const body = parseDiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal discovery request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const source = await services.receiptTrustDirectories.fetchJson(body.sourceUrl);
      const discovery = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(services.store, body, source);
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryHeaders(context, discovery);
      return context.json(discovery, discovery.status === "valid" ? 200 : 422);
    } catch (error) {
      if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal discovery failed", 502);
    }
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions", (context) => {
    const subscriptions = services.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions();
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionListHeaders(context, subscriptions);
    return context.json(subscriptions);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum activation selection rotation proposal subscription request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseCreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription request is invalid", 400);
    }
    let discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
    try {
      services.store.getThread(body.threadId);
      const source = await services.receiptTrustDirectories.fetchJson(body.sourceUrl);
      discovery = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery(services.store, body, source);
    } catch (error) {
      if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription discovery failed", 502);
    }
    if (discovery.status !== "valid") {
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryHeaders(context, discovery);
      return context.json(discovery, 422);
    }
    const subscription = await services.store.createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(body, discovery);
    await appendReceiptTrustEvent(services, subscription.auditThreadId, "receipt.trust_rotation_proposal_subscription.created", {
      subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256,
      policySha256: subscription.policySha256,
      envelopeSha256: subscription.lastGoodDiscovery?.envelopeSha256 ?? "",
      proposalSha256: subscription.lastGoodDiscovery?.proposalSha256 ?? "",
      preflightSha256: subscription.lastGoodDiscovery?.preflight?.contentSha256 ?? "",
    });
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionHeaders(context, subscription);
    return context.json(subscription, 201);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/refresh", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseRefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh request is invalid", 400);
    }
    const subscriptionId = context.req.param("subscriptionId");
    const result = await services.receiptTrustDirectorySubscriptions.refreshRotationProposal(subscriptionId, body.threadId, body.expectedRevision);
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshHeaders(context, result);
    return context.json(result);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval signing request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval signing request is invalid", 400);
    }
    const body = parseSignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval signing request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const subscription = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(context.req.param("subscriptionId"));
      const approval = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval(services.store, subscription, body);
      const envelope = signTrustedReceipt(approval, services.store.getReceiptTrustAnchor(body.trustAnchorId));
      const approvalApplyAfter = body.queueForApply ? (body.applyAfter ?? new Date().toISOString()) : undefined;
      const queuedSubscription = body.queueForApply ? await services.store.queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalApply(approval.subscriptionId, body.threadId, approval.subscriptionRevision, approval.subscriptionSha256, envelope, approvalApplyAfter) : undefined;
      await appendReceiptTrustEvent(services, body.threadId, "receipt.signed", {
        ...trustedReceiptEventPayload(envelope),
        subscriptionId: approval.subscriptionId,
        subscriptionRevision: approval.subscriptionRevision,
        subscriptionSha256: approval.subscriptionSha256,
        sourceUrlSha256: approval.sourceUrlSha256,
        sourceOriginSha256: approval.sourceOriginSha256,
        policySha256: approval.policySha256,
        discoverySha256: approval.discoverySha256,
        envelopeSha256: approval.envelopeSha256,
        proposalSha256: approval.proposalSha256,
        approvalPreflightSha256: approval.approvalPreflightSha256,
        activationDecisionRecordId: approval.activationDecisionRecordId,
        expectedCurrentSelectionSha256: approval.expectedCurrentSelectionSha256,
        proposalSignerKeyId: approval.proposalSignerKeyId,
        ...(approval.checkpointRegistryQuorumBaselineSha256
          ? {
              checkpointRegistryQuorumBaselineSha256: approval.checkpointRegistryQuorumBaselineSha256,
            }
          : {}),
        ...(queuedSubscription
          ? {
              queuedApprovalApply: true,
              approvalApplyAfter: approvalApplyAfter ?? "",
            }
          : {}),
      });
      if (queuedSubscription) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt.trust_rotation_proposal_approval_apply.queued", {
          subscriptionId: queuedSubscription.id,
          subscriptionRevision: queuedSubscription.revision,
          subscriptionSha256: queuedSubscription.contentSha256,
          sourceUrlSha256: queuedSubscription.sourceUrlSha256,
          sourceOriginSha256: queuedSubscription.sourceOriginSha256,
          approvalEnvelopeSha256: envelope.contentSha256,
          approvalSha256: approval.contentSha256,
          proposalSha256: approval.proposalSha256,
          approvalPreflightSha256: approval.approvalPreflightSha256,
          applyAfter: approvalApplyAfter ?? "",
        });
      }
      setTrustedReceiptHeaders(context, envelope, `napier-signed-quorum-activation-selection-rotation-proposal-subscription-approval-${envelope.contentSha256.slice(0, 12)}.json`);
      return context.json(envelope, 201);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply request is invalid", 400);
    }
    const body = parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const subscription = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(context.req.param("subscriptionId"));
      const approvalGate = verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyGate(services.store, subscription, body);
      if (approvalGate.status === "rejected") {
        return jsonError(context, approvalGate.reason, 409);
      }
      const result = await services.store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(body.threadId, approvalGate.proposal.activationDecisionRecordId, approvalGate.proposal.expectedCurrentSelectionSha256);
      if (result.applied) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt.trust_directory_quorum_activation_selection.applied", {
          selectionId: result.selection.id,
          selectionSha256: result.selection.contentSha256,
          activationDecisionRecordId: result.selection.activationDecisionRecordId,
          activationDecisionRecordSha256: result.selection.activationDecisionRecordSha256,
          activationDecisionEnvelopeSha256: result.selection.activationDecisionEnvelopeSha256,
          baselineId: result.selection.baselineId,
          baselineSha256: result.selection.baselineSha256,
          selectedAnchorSetSha256: result.selection.selectedAnchorSetSha256,
          selectedDirectorySha256: result.selection.selectedDirectorySha256,
          expectedCurrentSelectionSha256: result.expectedCurrentSelectionSha256,
          ...(result.previousSelectionSha256 ? { previousSelectionSha256: result.previousSelectionSha256 } : {}),
          rotationProposalEnvelopeSha256: approvalGate.proposalEnvelope.contentSha256,
          rotationProposalSha256: approvalGate.proposal.contentSha256,
          rotationProposalReviewSha256: approvalGate.proposal.rotationReviewSha256,
          rotationProposalCheckpointRegistryQuorumBaselineSha256: approvalGate.proposal.checkpointRegistryQuorumBaselineSha256 ?? "",
          rotationProposalApprovalEnvelopeSha256: approvalGate.approvalEnvelope.contentSha256,
          rotationProposalApprovalSha256: approvalGate.approval.contentSha256,
          rotationProposalApprovalPreflightSha256: approvalGate.approval.approvalPreflightSha256,
          rotationProposalApprovalCurrentPreflightSha256: approvalGate.preflight.contentSha256,
          rotationProposalApprovalSignerKeyId: approvalGate.approvalEnvelope.signature.keyId,
          rotationProposalSubscriptionId: approvalGate.approval.subscriptionId,
          rotationProposalSubscriptionRevision: approvalGate.approval.subscriptionRevision,
          rotationProposalSubscriptionSha256: approvalGate.approval.subscriptionSha256,
          selectionStateSha256: result.selectionState.contentSha256,
          resultSha256: result.contentSha256,
        });
      }
      setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionApprovalResultHeaders(context, result, approvalGate);
      return context.json(result, result.applied ? 201 : 200);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-review", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES * 10 + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review request is invalid", 400);
    }
    const body = parseReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy review request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const subscription = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(context.req.param("subscriptionId"));
      const { review } = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(services.store, subscription, body);
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(context, review);
      return context.json(review);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-apply", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES * 10 + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply request is invalid", 400);
    }
    const body = parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const subscription = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(context.req.param("subscriptionId"));
      const policyReview = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(services.store, subscription, body);
      if (policyReview.review.status !== "accepted" || policyReview.acceptedGates.length === 0) {
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(context, policyReview.review);
        return context.json(policyReview.review, 409);
      }
      const approvalGate = policyReview.acceptedGates[0]!;
      const result = await services.store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(body.threadId, approvalGate.proposal.activationDecisionRecordId, approvalGate.proposal.expectedCurrentSelectionSha256);
      const applyResult = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult(policyReview.review, result);
      if (result.applied) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt.trust_directory_quorum_activation_selection.policy_applied", {
          selectionId: result.selection.id,
          selectionSha256: result.selection.contentSha256,
          activationDecisionRecordId: result.selection.activationDecisionRecordId,
          activationDecisionRecordSha256: result.selection.activationDecisionRecordSha256,
          activationDecisionEnvelopeSha256: result.selection.activationDecisionEnvelopeSha256,
          baselineId: result.selection.baselineId,
          baselineSha256: result.selection.baselineSha256,
          selectedAnchorSetSha256: result.selection.selectedAnchorSetSha256,
          selectedDirectorySha256: result.selection.selectedDirectorySha256,
          expectedCurrentSelectionSha256: result.expectedCurrentSelectionSha256,
          ...(result.previousSelectionSha256 ? { previousSelectionSha256: result.previousSelectionSha256 } : {}),
          rotationProposalEnvelopeSha256: approvalGate.proposalEnvelope.contentSha256,
          rotationProposalSha256: approvalGate.proposal.contentSha256,
          rotationProposalReviewSha256: approvalGate.proposal.rotationReviewSha256,
          rotationProposalApprovalPolicyReviewSha256: policyReview.review.contentSha256,
          rotationProposalApprovalPolicySha256: policyReview.review.approvalPolicySha256,
          rotationProposalApprovalPolicyDistinctSignerCount: policyReview.review.distinctSignerCount,
          rotationProposalApprovalPolicyAcceptedApprovalCount: policyReview.review.acceptedApprovalCount,
          rotationProposalApprovalPolicySignerSetSha256: policyReview.review.signerSetSha256,
          rotationProposalSubscriptionId: policyReview.review.subscriptionId,
          rotationProposalSubscriptionRevision: policyReview.review.subscriptionRevision,
          rotationProposalSubscriptionSha256: policyReview.review.subscriptionSha256,
          selectionStateSha256: result.selectionState.contentSha256,
          resultSha256: result.contentSha256,
          applyResultSha256: applyResult.contentSha256,
        });
      }
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders(context, applyResult);
      return context.json(applyResult, result.applied ? 201 : 200);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-apply/queue", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES * 10 + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply queue request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply queue request is invalid", 400);
    }
    const body = parseQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy apply queue request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const subscription = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(context.req.param("subscriptionId"));
      const policyReview = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(services.store, subscription, body);
      if (policyReview.review.status !== "accepted" || policyReview.acceptedGates.length === 0) {
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(context, policyReview.review);
        return context.json(policyReview.review, 409);
      }
      const baselineGate = verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineGate(services.store, policyReview.review, body.approvalPolicyBaselineSha256);
      if (baselineGate.status === "rejected") {
        return jsonError(context, `Receipt trust anchor directory quorum activation selection rotation proposal subscription approval policy baseline is not accepted: ${baselineGate.diagnostics.join(",")}`, 409);
      }
      const applyAfter = body.applyAfter ?? new Date().toISOString();
      const queuedSubscription = await services.store.queueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalApprovalPolicyApply(subscription.id, body.threadId, body.expectedSubscriptionRevision, body.expectedSubscriptionSha256, body.approvalEnvelopes, body.approvalPolicy, body.approvalPolicyBaselineSha256, applyAfter);
      const queueResult = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyQueueResult(queuedSubscription, policyReview.review, body.approvalPolicyBaselineSha256, applyAfter);
      await appendReceiptTrustEvent(services, body.threadId, "receipt.trust_rotation_proposal_approval_policy_apply.queued", {
        subscriptionId: queuedSubscription.id,
        subscriptionRevision: queuedSubscription.revision,
        subscriptionSha256: queuedSubscription.contentSha256,
        sourceUrlSha256: queuedSubscription.sourceUrlSha256,
        sourceOriginSha256: queuedSubscription.sourceOriginSha256,
        applyAfter,
        approvalPolicyBaselineSha256: body.approvalPolicyBaselineSha256,
        approvalPolicySha256: policyReview.review.approvalPolicySha256,
        approvalEnvelopeSetSha256: policyReview.review.approvalEnvelopeSetSha256,
        acceptedApprovalEnvelopeSetSha256: policyReview.review.acceptedApprovalEnvelopeSetSha256,
        signerSetSha256: policyReview.review.signerSetSha256,
        policyReviewSha256: policyReview.review.contentSha256,
        queueResultSha256: queueResult.contentSha256,
      });
      setQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders(context, queueResult);
      return context.json(queueResult, 202);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.get("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines", (context) => {
    const baselines = services.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines();
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineListHeaders(context, baselines);
    return context.json(baselines);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-baselines", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES * 10 + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust rotation proposal approval policy baseline request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust rotation proposal approval policy baseline request is invalid", 400);
    }
    const body = parsePromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust rotation proposal approval policy baseline request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const subscription = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(context.req.param("subscriptionId"));
      const { review } = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(services.store, subscription, body);
      if (review.status !== "accepted") {
        setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(context, review);
        return context.json(review, 409);
      }
      const envelope = signTrustedReceipt(review, services.store.getReceiptTrustAnchor(body.trustAnchorId));
      const result = await services.store.promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(body.threadId, envelope);
      if (result.created) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt_trust.rotation_approval_policy_baseline.promoted", {
          ...trustedReceiptEventPayload(envelope),
          baselineId: result.baseline.id,
          baselineSha256: result.baseline.contentSha256,
          approvalPolicySha256: result.baseline.approvalPolicySha256,
          subscriptionSha256: result.baseline.subscriptionSha256,
          acceptedApprovalEnvelopeSetSha256: result.baseline.acceptedApprovalEnvelopeSetSha256,
          signerSetSha256: result.baseline.signerSetSha256,
          ...(result.baseline.requiredSignerSetSha256
            ? {
                requiredSignerSetSha256: result.baseline.requiredSignerSetSha256,
              }
            : {}),
        });
      }
      setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders(context, result);
      return context.json(result, result.created ? 201 : 200);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("not trusted") || message.includes("requires an accepted review") ? 409 : 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust rotation proposal approval policy baseline verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust rotation proposal approval policy baseline verification request is invalid", 400);
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust rotation proposal approval policy baseline verification request is invalid", 400);
    }
    const trustDirectoryVerification = body.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(body.trustDirectory, body.trustDirectoryPolicy);
    const anchors = body.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(body.trustDirectory) : [];
    const verification = verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(body.baseline, anchors);
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines/import", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust rotation proposal approval policy baseline import request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust rotation proposal approval policy baseline import request is invalid", 400);
    }
    const body = parseImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust rotation proposal approval policy baseline import request is invalid", 400);
    }
    const trustDirectoryVerification = body.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(body.trustDirectory, body.trustDirectoryPolicy);
    const anchors = body.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(body.trustDirectory) : [];
    const verification = verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(body.baseline, anchors);
    if (verification.status !== "trusted" || !verification.baselineValid || !verification.signatureValid || !verification.integrityValid) {
      return jsonError(context, "Receipt trust rotation proposal approval policy baseline import requires trusted verification", 409);
    }
    try {
      const imported = await services.store.importReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(body.threadId, body.baseline, body.expectedCurrentBaselineSha256, anchors);
      if (imported.imported) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt_trust.rotation_approval_policy_baseline.imported", {
          baselineId: imported.baseline.id,
          baselineSha256: imported.baseline.contentSha256,
          policyReviewSha256: imported.baseline.envelope.receipt.contentSha256,
          envelopeSha256: imported.baseline.envelope.contentSha256,
          keyId: imported.baseline.envelope.signature.keyId,
          expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
          verificationSha256: verification.contentSha256,
          ...(imported.previousBaselineSha256 ? { previousBaselineSha256: imported.previousBaselineSha256 } : {}),
        });
      }
      const result: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult = {
        baseline: imported.baseline,
        imported: imported.imported,
        verification,
        expectedCurrentBaselineSha256: body.expectedCurrentBaselineSha256,
        ...(imported.previousBaselineSha256 ? { previousBaselineSha256: imported.previousBaselineSha256 } : {}),
      };
      setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders(context, result);
      return context.json(result, imported.imported ? 201 : 200);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("precondition") ? 409 : 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply/replay", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay request is invalid", 400);
    }
    const body = parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription approval apply replay request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const subscription = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(context.req.param("subscriptionId"));
      const replay = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay(services.store, subscription, body);
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplayHeaders(context, replay);
      return context.json(replay);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal subscription update request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory quorum activation selection rotation proposal subscription update request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseUpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal subscription update request is invalid", 400);
    }
    const before = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(context.req.param("subscriptionId"));
    const subscription = await services.store.updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(before.id, body);
    if (before.revision !== subscription.revision) {
      await appendReceiptTrustEvent(services, subscription.auditThreadId, "receipt.trust_rotation_proposal_subscription.updated", {
        subscriptionId: subscription.id,
        subscriptionRevision: subscription.revision,
        subscriptionSha256: subscription.contentSha256,
        sourceUrlSha256: subscription.sourceUrlSha256,
        sourceOriginSha256: subscription.sourceOriginSha256,
        status: subscription.status,
      });
    }
    setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionHeaders(context, subscription);
    return context.json(subscription);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/preflight", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection rotation proposal preflight request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal preflight request is invalid", 400);
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection rotation proposal preflight request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const preflight = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight(services.store, body);
      setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflightHeaders(context, preflight);
      return context.json(preflight, 200);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation selection request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation selection request is invalid", 400);
    }
    const body = parseApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation selection request is invalid", 400);
    }
    try {
      const selectionState = services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
      const activeSelection = selectionState.selection;
      const willRotateActiveSelection = activeSelection !== undefined && activeSelection.activationDecisionRecordId !== body.activationDecisionRecordId;
      const proposalGate = willRotateActiveSelection ? verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalGate(services.store, body) : undefined;
      if (proposalGate?.status === "rejected") {
        return jsonError(context, proposalGate.reason, 409);
      }
      const result = await services.store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(body.threadId, body.activationDecisionRecordId, body.expectedCurrentSelectionSha256);
      if (result.applied) {
        await appendReceiptTrustEvent(services, body.threadId, "receipt.trust_directory_quorum_activation_selection.applied", {
          selectionId: result.selection.id,
          selectionSha256: result.selection.contentSha256,
          activationDecisionRecordId: result.selection.activationDecisionRecordId,
          activationDecisionRecordSha256: result.selection.activationDecisionRecordSha256,
          activationDecisionEnvelopeSha256: result.selection.activationDecisionEnvelopeSha256,
          baselineId: result.selection.baselineId,
          baselineSha256: result.selection.baselineSha256,
          selectedAnchorSetSha256: result.selection.selectedAnchorSetSha256,
          selectedDirectorySha256: result.selection.selectedDirectorySha256,
          expectedCurrentSelectionSha256: result.expectedCurrentSelectionSha256,
          ...(result.previousSelectionSha256 ? { previousSelectionSha256: result.previousSelectionSha256 } : {}),
          ...(proposalGate?.status === "accepted"
            ? {
                rotationProposalEnvelopeSha256: proposalGate.envelope.contentSha256,
                rotationProposalSha256: proposalGate.proposal.contentSha256,
                rotationProposalReviewSha256: proposalGate.proposal.rotationReviewSha256,
                rotationProposalCheckpointRegistryQuorumBaselineSha256: proposalGate.proposal.checkpointRegistryQuorumBaselineSha256 ?? "",
              }
            : {}),
          selectionStateSha256: result.selectionState.contentSha256,
          resultSha256: result.contentSha256,
        });
      }
      setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResultHeaders(context, result);
      return context.json(result, result.applied ? 201 : 200);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("precondition failed") ? 409 : 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory quorum activation decision request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory quorum activation decision request is invalid", 400);
    }
    const body = parseSignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory quorum activation decision request is invalid", 400);
    }
    try {
      services.store.getThread(body.threadId);
      const baselines = services.store.listReceiptTrustAnchorDirectoryQuorumPromotionBaselines();
      const baseline = body.baselineId === undefined ? baselines.at(-1) : baselines.find((candidate) => candidate.id === body.baselineId);
      if (!baseline) {
        return jsonError(context, "Receipt trust anchor directory quorum activation decision baseline was not found", 404);
      }
      const trustDirectoryVerification = body.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(body.trustDirectory, body.trustDirectoryPolicy);
      const anchors = body.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(body.trustDirectory) : [];
      const verification = verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(baseline, anchors, {
        ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
      });
      const policyReview = reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(baseline, body.importPolicy);
      const sourceAlignment = createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(baseline, services.store.listReceiptTrustAnchorDirectorySubscriptions());
      const receipt = createReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt({
        baseline,
        verification,
        policyReview,
        sourceAlignment,
      });
      const envelope = signTrustedReceipt(receipt, services.store.getReceiptTrustAnchor(body.trustAnchorId));
      const result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult = {
        baseline,
        verification,
        policyReview,
        sourceAlignment,
        envelope,
      };
      const record = await services.store.recordReceiptTrustAnchorDirectoryQuorumActivationDecision(body.threadId, result);
      await appendReceiptTrustEvent(services, body.threadId, "receipt_trust.directory_quorum_activation_decision.signed", {
        ...trustedReceiptEventPayload(envelope),
        decision: receipt.decision,
        baselineId: baseline.id,
        baselineSha256: baseline.contentSha256,
        verificationSha256: verification.contentSha256,
        policyReviewSha256: policyReview.contentSha256,
        sourceAlignmentSha256: sourceAlignment.contentSha256,
        recordId: record.id,
        recordSha256: record.contentSha256,
        alignedSourceCount: sourceAlignment.alignedSourceCount,
        driftedSourceCount: sourceAlignment.driftedSourceCount,
        missingSourceCount: sourceAlignment.missingSourceCount,
      });
      setReceiptTrustAnchorDirectoryQuorumActivationDecisionResultHeaders(context, result);
      context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", record.id);
      context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-SHA256", record.contentSha256);
      return context.json(result, 201);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory subscription request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory subscription request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseCreateReceiptTrustAnchorDirectorySubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory subscription request is invalid", 400);
    }
    let discovery: ReceiptTrustAnchorDirectoryDiscovery;
    try {
      discovery = await services.receiptTrustDirectories.discover({
        sourceUrl: body.sourceUrl,
        policy: body.policy,
      });
    } catch (error) {
      if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, "Receipt trust anchor directory subscription discovery failed", 502);
    }
    if (discovery.status !== "valid") {
      setReceiptTrustAnchorDirectoryDiscoveryHeaders(context, discovery);
      return context.json(discovery, 422);
    }
    const subscription = await services.store.createReceiptTrustAnchorDirectorySubscription(body, discovery);
    await appendReceiptTrustEvent(services, subscription.auditThreadId, "receipt.trust_directory_subscription.created", {
      subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256,
      policySha256: subscription.policySha256,
      directorySha256: subscription.lastGoodDiscovery?.directory?.contentSha256 ?? "",
      anchorSetSha256: subscription.lastGoodDiscovery?.directory?.anchorSetSha256 ?? "",
    });
    setReceiptTrustAnchorDirectorySubscriptionHeaders(context, subscription);
    return context.json(subscription, 201);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/:subscriptionId/refresh", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory subscription refresh request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory subscription refresh request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseRefreshReceiptTrustAnchorDirectorySubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory subscription refresh request is invalid", 400);
    }
    const result = await services.receiptTrustDirectorySubscriptions.refresh(context.req.param("subscriptionId"), body.threadId, body.expectedRevision);
    setReceiptTrustAnchorDirectorySubscriptionRefreshHeaders(context, result);
    return context.json(result);
  });

  app.post("/api/receipt-trust/anchors/directory/subscriptions/:subscriptionId", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory subscription update request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory subscription update request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseUpdateReceiptTrustAnchorDirectorySubscriptionRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory subscription update request is invalid", 400);
    }
    const before = services.store.getReceiptTrustAnchorDirectorySubscription(context.req.param("subscriptionId"));
    const subscription = await services.store.updateReceiptTrustAnchorDirectorySubscription(before.id, body);
    if (before.revision !== subscription.revision) {
      await appendReceiptTrustEvent(services, subscription.auditThreadId, "receipt.trust_directory_subscription.updated", {
        subscriptionId: subscription.id,
        subscriptionRevision: subscription.revision,
        subscriptionSha256: subscription.contentSha256,
        sourceUrlSha256: subscription.sourceUrlSha256,
        sourceOriginSha256: subscription.sourceOriginSha256,
        status: subscription.status,
      });
    }
    setReceiptTrustAnchorDirectorySubscriptionHeaders(context, subscription);
    return context.json(subscription);
  });

  app.post("/api/receipt-trust/anchors/directory/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES, "Receipt trust anchor directory verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory verification request is invalid", 400);
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory verification request is invalid", 400);
    }
    const verification = services.store.verifyReceiptTrustAnchorDirectory(body.directory, body.policy);
    setReceiptTrustAnchorDirectoryVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/receipt-trust/anchors/directory/metadata/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory metadata verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Receipt trust anchor directory metadata verification request is invalid", 400);
    }
    const body = parseVerifyReceiptTrustAnchorDirectoryMetadataRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory metadata verification request is invalid", 400);
    }
    const trustDirectoryVerification = body.trustDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(body.trustDirectory, body.trustDirectoryPolicy);
    const anchors = body.trustDirectory === undefined ? services.store.listReceiptTrustAnchors() : trustDirectoryVerification?.status === "valid" ? receiptTrustAnchorsFromDirectory(body.trustDirectory) : [];
    const verification = verifyReceiptTrustAnchorDirectoryMetadata(body.envelope, body.directory, anchors, {
      ...(body.directoryPolicy ? { directoryPolicy: body.directoryPolicy } : {}),
      ...(trustDirectoryVerification ? { trustDirectoryVerification } : {}),
    });
    setReceiptTrustAnchorDirectoryMetadataVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/receipt-trust/anchors/directory/discover", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor directory discovery request");
    } catch (error) {
      return jsonError(context, error instanceof RequestBodyTooLargeError ? error.message : "Receipt trust anchor directory discovery request is invalid", error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseDiscoverReceiptTrustAnchorDirectoryRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor directory discovery request is invalid", 400);
    }
    try {
      const discovery = await services.receiptTrustDirectories.discover(body);
      setReceiptTrustAnchorDirectoryDiscoveryHeaders(context, discovery);
      return context.json(discovery);
    } catch (error) {
      if (error instanceof ReceiptTrustAnchorDirectoryDiscoveryError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, "Receipt trust anchor directory discovery failed", 502);
    }
  });

  app.post("/api/receipt-trust/anchors", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseCreateReceiptTrustAnchorRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor is invalid", 400);
    }
    const anchor = await services.store.createReceiptTrustAnchor(body);
    await appendReceiptTrustEvent(services, body.threadId, "receipt.trust_anchor.created", {
      trustAnchorId: anchor.id,
      keyId: anchor.keyId,
      algorithm: anchor.algorithm,
      status: anchor.status,
      signingCapable: Boolean(anchor.signingSource),
      anchorSha256: anchor.contentSha256,
    });
    setReceiptTrustAnchorHeaders(context, anchor);
    return context.json(anchor, 201);
  });

  app.post("/api/receipt-trust/anchors/:anchorId/revoke", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Receipt trust anchor revocation request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseRevokeReceiptTrustAnchorRequest(input);
    if (!body) {
      return jsonError(context, "Receipt trust anchor revocation is invalid", 400);
    }
    services.store.getThread(body.threadId);
    const before = services.store.getReceiptTrustAnchor(context.req.param("anchorId"));
    const anchor = await services.store.revokeReceiptTrustAnchor(before.id);
    if (before.status !== anchor.status) {
      await appendReceiptTrustEvent(services, body.threadId, "receipt.trust_anchor.revoked", {
        trustAnchorId: anchor.id,
        keyId: anchor.keyId,
        status: anchor.status,
        anchorSha256: anchor.contentSha256,
      });
    }
    setReceiptTrustAnchorHeaders(context, anchor);
    return context.json(anchor);
  });

  app.post("/api/receipt-trust/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUSTED_RECEIPT_BYTES + 1_024, "Trusted receipt request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Trusted receipt request is invalid", 400);
    }
    const body = parseVerifyTrustedReceiptRequest(input);
    if (!body) {
      return jsonError(context, "Trusted receipt request is invalid", 400);
    }
    const activeSelectionState = body.directory === undefined ? services.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState() : undefined;
    const activeSelection = activeSelectionState?.selection;
    const directorySource = body.directory !== undefined ? ("uploaded" as const) : activeSelection ? ("active_selection" as const) : undefined;
    const selectedDirectory = body.directory !== undefined ? body.directory : activeSelection?.selectedDirectory;
    const directoryPolicy =
      body.directory !== undefined
        ? body.directoryPolicy
        : activeSelection
          ? {
              expectedAnchorSetSha256: activeSelection.selectedAnchorSetSha256,
            }
          : undefined;
    const directoryVerification = selectedDirectory === undefined ? undefined : services.store.verifyReceiptTrustAnchorDirectory(selectedDirectory, directoryPolicy);
    if (directoryVerification?.status === "invalid") {
      const verification: TrustedReceiptVerification = {
        status: "invalid",
        verifiedAt: new Date().toISOString(),
        ...(directorySource ? { anchorDirectorySource: directorySource } : {}),
        anchorDirectorySha256: directoryVerification.declaredContentSha256 ?? directoryVerification.recomputedContentSha256 ?? directoryVerification.contentSha256,
        anchorDirectoryVerificationSha256: directoryVerification.contentSha256,
        ...(directoryVerification.policySha256 ? { anchorDirectoryPolicySha256: directoryVerification.policySha256 } : {}),
        ...(directoryVerification.directoryGeneratedAt
          ? {
              anchorDirectoryGeneratedAt: directoryVerification.directoryGeneratedAt,
            }
          : {}),
        ...(directoryVerification.directoryAgeMs !== undefined ? { anchorDirectoryAgeMs: directoryVerification.directoryAgeMs } : {}),
        ...(directoryVerification.anchorCount !== undefined ? { anchorDirectoryAnchorCount: directoryVerification.anchorCount } : {}),
        ...(activeSelection
          ? {
              anchorDirectorySelectionId: activeSelection.id,
              anchorDirectorySelectionSha256: activeSelection.contentSha256,
              ...(activeSelectionState
                ? {
                    anchorDirectorySelectionStateSha256: activeSelectionState.contentSha256,
                  }
                : {}),
            }
          : {}),
        signatureValid: false,
        integrityValid: false,
        reason: directorySource === "active_selection" ? "Active receipt trust anchor directory selection is invalid" : "Receipt trust anchor directory is invalid",
      };
      setTrustedReceiptVerificationHeaders(context, verification);
      return context.json(verification);
    }
    const directory = selectedDirectory === undefined ? undefined : receiptTrustAnchorsFromDirectory(selectedDirectory);
    const verification = verifyTrustedReceiptEnvelope(body.envelope, directory ?? services.store.listReceiptTrustAnchors());
    const verifiedWithDirectory: TrustedReceiptVerification = directoryVerification
      ? {
          ...verification,
          ...(directorySource ? { anchorDirectorySource: directorySource } : {}),
          ...(directoryVerification.declaredContentSha256
            ? {
                anchorDirectorySha256: directoryVerification.declaredContentSha256,
              }
            : {}),
          anchorDirectoryVerificationSha256: directoryVerification.contentSha256,
          ...(directoryVerification.policySha256
            ? {
                anchorDirectoryPolicySha256: directoryVerification.policySha256,
              }
            : {}),
          ...(directoryVerification.directoryGeneratedAt
            ? {
                anchorDirectoryGeneratedAt: directoryVerification.directoryGeneratedAt,
              }
            : {}),
          ...(directoryVerification.directoryAgeMs !== undefined ? { anchorDirectoryAgeMs: directoryVerification.directoryAgeMs } : {}),
          ...(directoryVerification.anchorCount !== undefined
            ? {
                anchorDirectoryAnchorCount: directoryVerification.anchorCount,
              }
            : {}),
          ...(activeSelection
            ? {
                anchorDirectorySelectionId: activeSelection.id,
                anchorDirectorySelectionSha256: activeSelection.contentSha256,
                ...(activeSelectionState
                  ? {
                      anchorDirectorySelectionStateSha256: activeSelectionState.contentSha256,
                    }
                  : {}),
              }
            : {}),
        }
      : verification;
    setTrustedReceiptVerificationHeaders(context, verifiedWithDirectory);
    return context.json(verifiedWithDirectory);
  });

  registerBootstrapHttp(app, services);
  services.browserTasks.register(app);

  app.get("/api/usage-price-tables", (context) => {
    const catalog = builtinUsagePriceTableCatalog();
    setUsagePriceTableCatalogHeaders(context, catalog);
    return context.json(catalog);
  });

  app.post("/api/usage-price-tables/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, 64 * 1024, "Usage price table verification request");
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    const body = parseVerifyUsagePriceTableCatalogRequest(input);
    if (!body) {
      return jsonError(context, "Invalid usage price table request", 400);
    }
    const verification = verifyUsagePriceTableCatalog(body.catalog, body.requiredProviders ? { requiredProviders: body.requiredProviders } : {});
    setUsagePriceTableVerificationHeaders(context, verification);
    return context.json(verification);
  });

  registerThreadLifecycleHttp(app, services);
  registerThreadOperationsHttp(app, services);
  registerWorkspaceRootHttp(app, services, options?.rebindWorkspace);
  registerRecentWorkspacesHttp(app, options?.listWorkspaceThreads);

  registerWorkspaceProcessHttp(app, services.workspaceProcesses, {
    jsonError,
    errorMessage,
    readLimitedJson,
    requestBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
    requestRecord: (input, keys) => requestRecord(input, [...keys]),
    setProjectionHeaders: setWorkspaceProcessProjectionHeaders,
  });

  registerScheduleHttp(app, services);

  registerInboundChannelAdminHttp(app, services);

  registerInboundChannelDeliveryHttp(app, services);

  registerInboundChannelDeadLetterHttp(app, services);

  registerInboundChannelIngressHttp(app, services);

  registerAgentProfileHttp(app, services);

  registerThreadEvidenceHttp(app, services);

  registerThreadEvaluationHttp(app, services.store);

  registerEvaluationCatalogHttp(app, services.store, {
    setCasebookListHeaders: setEvaluationCasebookListHeaders,
    setCasebookHeaders: setEvaluationCasebookProjectionHeaders,
    setCalibrationHeaders: setEvaluationCasebookCalibrationHeaders,
    setArtifactHeaders: setEvaluationCasebookArtifactHeaders,
    setQualificationListHeaders: setEvaluationCasebookQualificationListHeaders,
    setQualificationReceiptHeaders: setEvaluationCasebookQualificationReceiptHeaders,
    setBaselineListHeaders: setEvaluationQualificationBaselineListHeaders,
    setSuiteListHeaders: setEvaluationSuiteListHeaders,
    setSuiteReceiptHeaders: setEvaluationSuiteGateReceiptHeaders,
    setSuiteExecutionListHeaders: setEvaluationSuiteExecutionListHeaders,
  });

  app.post("/api/evaluation-casebooks/:casebookId/signed-qualification-receipt", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Signed qualification receipt request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseSignTrustedReceiptRequest(input, true);
    if (!body?.threadId) {
      return jsonError(context, "Signed qualification receipt request is invalid", 400);
    }
    services.store.getThread(body.threadId);
    const receipt = createEvaluationCasebookQualificationReceipt(services.store, context.req.param("casebookId"));
    const envelope = signTrustedReceipt(receipt, services.store.getReceiptTrustAnchor(body.trustAnchorId));
    await appendReceiptTrustEvent(services, body.threadId, "receipt.signed", trustedReceiptEventPayload(envelope));
    setTrustedReceiptHeaders(context, envelope, `napier-signed-casebook-qualification-${receipt.casebook.id}-r${receipt.casebook.currentRevision}-${envelope.contentSha256.slice(0, 12)}.json`);
    return context.json(envelope, 201);
  });

  app.post("/api/evaluation-casebooks/:casebookId/qualification-baselines", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Qualification baseline request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parsePromoteEvaluationQualificationBaselineRequest(input);
    if (!body) {
      return jsonError(context, "Qualification baseline request is invalid", 400);
    }
    services.store.getThread(body.threadId);
    const casebookId = context.req.param("casebookId");
    const receipt = createEvaluationCasebookQualificationReceipt(services.store, casebookId);
    if (receipt.state !== "passed") {
      return jsonError(context, "Qualification baseline requires a current passing receipt", 409);
    }
    const envelope = signTrustedReceipt(receipt, services.store.getReceiptTrustAnchor(body.trustAnchorId));
    let result;
    try {
      result = await services.store.promoteEvaluationQualificationBaseline(casebookId, body.threadId, envelope);
    } catch (error) {
      if (error instanceof Error && (error.message.includes("current passing receipt") || error.message.includes("not trusted") || error.message.includes("changed"))) {
        return jsonError(context, error.message, 409);
      }
      throw error;
    }
    if (result.created) {
      await appendReceiptTrustEvent(services, body.threadId, "evaluation.casebook.qualification_baseline.promoted", {
        baselineId: result.baseline.id,
        casebookId: result.baseline.casebookId,
        casebookRevision: result.baseline.casebookRevision,
        qualificationExecutionId: result.baseline.qualificationExecutionId,
        keyId: result.baseline.envelope.signature.keyId,
        receiptSha256: result.baseline.envelope.receipt.contentSha256,
        receiptArtifactSha256: result.baseline.envelope.signature.receiptArtifactSha256,
        envelopeSha256: result.baseline.envelope.contentSha256,
        baselineSha256: result.baseline.contentSha256,
      });
    }
    setPromoteEvaluationQualificationBaselineResultHeaders(context, result);
    return context.json(result, result.created ? 201 : 200);
  });

  app.post("/api/threads/:threadId/evaluation-suites/:suiteId/signed-receipt", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Signed evaluation gate receipt request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseSignTrustedReceiptRequest(input, false);
    if (!body) {
      return jsonError(context, "Signed evaluation gate receipt request is invalid", 400);
    }
    const threadId = context.req.param("threadId");
    const receipt = createEvaluationSuiteGateReceipt(services.store, threadId, context.req.param("suiteId"));
    const envelope = signTrustedReceipt(receipt, services.store.getReceiptTrustAnchor(body.trustAnchorId));
    await appendReceiptTrustEvent(services, threadId, "receipt.signed", trustedReceiptEventPayload(envelope));
    setTrustedReceiptHeaders(context, envelope, `napier-signed-gate-${receipt.suite.id}-r${receipt.suite.revision}-${envelope.contentSha256.slice(0, 12)}.json`);
    return context.json(envelope, 201);
  });

  registerPlanLifecycleHttp(app, services);

  registerPlanBlueprintLibraryHttp(app, services.store);

  app.get("/api/plan-blueprints/portfolio/calibration", async (context) => {
    const calibration = await services.store.calibrateExecutionPlanBlueprintPortfolio();
    setExecutionPlanBlueprintPortfolioCalibrationHeaders(context, calibration);
    return context.json(calibration);
  });

  app.get("/api/plan-blueprints/portfolio/recommendation-policy-backtest", async (context) => {
    const backtest = await services.store.backtestExecutionPlanBlueprintRecommendationPolicies();
    setExecutionPlanBlueprintRecommendationPolicyBacktestHeaders(context, backtest);
    return context.json(backtest);
  });

  app.get("/api/plan-blueprints/portfolio/recommendation-policy-overrides", async (context) => {
    const overrides = await services.store.listExecutionPlanBlueprintRecommendationPolicyOverrides();
    setExecutionPlanBlueprintRecommendationPolicyOverrideListHeaders(context, overrides);
    return context.json(overrides);
  });

  app.get("/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review", async (context) => {
    const review = await services.store.reviewExecutionPlanBlueprintRecommendationPolicyOverrideDrift();
    setExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewHeaders(context, review);
    return context.json(review);
  });

  app.get("/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements", async (context) => {
    const history = await services.store.listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements();
    setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryHeaders(context, history);
    return context.json(history);
  });

  app.post("/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_EXECUTION_PLAN_BLUEPRINT_BYTES, "Execution plan blueprint recommendation policy override retirement history verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Execution plan blueprint recommendation policy override retirement history verification request is invalid", 400);
    }
    const request = parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest(input);
    if (!request) {
      return jsonError(context, "Execution plan blueprint recommendation policy override retirement history verification request is invalid", 400);
    }
    const verification = await services.store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(request.history);
    setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_THREAD_REPLAY_BUNDLE_BYTES, "Execution plan blueprint recommendation policy override retirement history proof bundle verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Execution plan blueprint recommendation policy override retirement history proof bundle verification request is invalid", 400);
    }
    const request = parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest(input);
    if (!request) {
      return jsonError(context, "Execution plan blueprint recommendation policy override retirement history proof bundle verification request is invalid", 400);
    }
    const proofBundle = services.store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(request.histories);
    setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleHeaders(context, proofBundle);
    return context.json(proofBundle);
  });

  app.post("/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_THREAD_REPLAY_BUNDLE_BYTES, "Execution plan blueprint recommendation policy override retirement history proof bundle signing request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Execution plan blueprint recommendation policy override retirement history proof bundle signing request is invalid", 400);
    }
    const request = parseSignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest(input);
    if (!request) {
      return jsonError(context, "Execution plan blueprint recommendation policy override retirement history proof bundle signing request is invalid", 400);
    }
    try {
      services.store.getThread(request.threadId);
      const proofBundle = services.store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(request.histories);
      if (proofBundle.status === "invalid") {
        return jsonError(context, "Execution plan blueprint recommendation policy override retirement history proof bundle is invalid", 409);
      }
      const envelope = signTrustedReceipt(proofBundle, services.store.getReceiptTrustAnchor(request.trustAnchorId));
      await appendReceiptTrustEvent(services, request.threadId, "receipt.signed", trustedReceiptEventPayload(envelope));
      setTrustedReceiptHeaders(context, envelope, `napier-signed-policy-retirement-proof-bundle-${envelope.contentSha256.slice(0, 12)}.json`);
      return context.json(envelope, 201);
    } catch (error) {
      const message = errorMessage(error);
      const caught = error instanceof Error ? error : new Error(message);
      return jsonError(context, message, message.includes("proof bundle is invalid") || isReceiptTrustConflict(caught) ? 409 : isReceiptTrustClientError(caught) ? 400 : 500);
    }
  });

  app.post("/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_EXECUTION_PLAN_BLUEPRINT_BYTES, "Execution plan blueprint recommendation policy override retirement request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Execution plan blueprint recommendation policy override retirement request is invalid", 400);
    }
    const request = parseRetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest(input);
    if (!request) {
      return jsonError(context, "Execution plan blueprint recommendation policy override retirement request is invalid", 400);
    }
    try {
      const result = await services.store.retireExecutionPlanBlueprintRecommendationPolicyOverride(request);
      setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHeaders(context, result);
      return context.json(result);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("changed") || message.includes("missing") || message.includes("not retire recommended") ? 409 : 400);
    }
  });

  app.post("/api/plan-blueprints/portfolio/recommendation-policy-overrides", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_EXECUTION_PLAN_BLUEPRINT_BYTES, "Execution plan blueprint recommendation policy override request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Execution plan blueprint recommendation policy override request is invalid", 400);
    }
    const request = parseSetExecutionPlanBlueprintRecommendationPolicyOverrideRequest(input);
    if (!request) {
      return jsonError(context, "Execution plan blueprint recommendation policy override request is invalid", 400);
    }
    try {
      const override = await services.store.setExecutionPlanBlueprintRecommendationPolicyOverride(request);
      setExecutionPlanBlueprintRecommendationPolicyOverrideHeaders(context, override);
      return context.json(override);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(context, message, message.includes("portfolio set changed") || message.includes("family is missing") ? 409 : 400);
    }
  });

  registerPlanBlueprintReplayHttp(app, services.store);

  registerPlanBlueprintOutcomeHttp(app, services);

  registerPlanBlueprintInstantiationHttp(app, services.store);

  registerPlanProgressHttp(app, services.store);

  registerPlanArtifactInspectionHttp(app, services.store, services.sandbox);

  registerPlanArtifactFileHttp(app, services.store);

  registerPlanArtifactDirectoryHttp(app, services.store);

  registerPlanArtifactDataHttp(app, services.store);

  registerRunEvaluationHttp(
    app,
    {
      store: services.store,
      models: services.models,
      evaluations: services.evaluations,
    },
    {
      readRequest: (request, label) => readLimitedJson(request, MAX_EVALUATION_REQUEST_BYTES, label),
      requestBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
      errorMessage,
      jsonError,
    },
  );

  registerEvaluationReviewHttp(app, services.store, {
    readRequest: (request, label) => readLimitedJson(request, MAX_EVALUATION_REQUEST_BYTES, label),
    requestBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
    errorMessage,
    jsonError,
  });

  registerEvaluationCasebookAdminHttp(
    app,
    {
      store: services.store,
      models: services.models,
      qualifications: services.evaluationCasebookQualifications,
    },
    {
      readRequest: (request, label) => readLimitedJson(request, MAX_EVALUATION_REQUEST_BYTES, label),
      requestBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
      errorMessage,
      jsonError,
    },
  );

  registerReleaseEvidenceHttp(app, services.store, {
    readRequest: (request, label) => readLimitedJson(request, MAX_EVALUATION_REQUEST_BYTES, label),
    requestBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
    errorMessage,
    jsonError,
  });

  registerEvaluationSuiteAdminHttp(
    app,
    {
      store: services.store,
      models: services.models,
      suites: services.evaluationSuites,
    },
    {
      readRequest: (request, label) => readLimitedJson(request, MAX_EVALUATION_REQUEST_BYTES, label),
      requestBodyTooLarge: (error) => error instanceof RequestBodyTooLargeError,
      errorMessage,
      jsonError,
    },
  );

  registerMemoryHttp(app, services.store);
  registerCredentialHttp(app, services);

  app.get("/api/extensions", (context) => {
    const agentId = context.req.query("agent");
    const extensions = services.store.listExtensions(agentId ? { agentId } : {});
    setExtensionListHeaders(context, extensions, agentId);
    return context.json(extensions);
  });

  app.get("/api/extensions/publishers", (context) => {
    const anchors = services.store.listExtensionPublisherTrustAnchors();
    setExtensionPublisherTrustAnchorListHeaders(context, anchors);
    return context.json(anchors);
  });

  app.post("/api/extensions/publishers", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Extension publisher trust anchor request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseCreateExtensionPublisherTrustAnchorRequest(input);
    if (!body) {
      return jsonError(context, "Extension publisher trust anchor is invalid", 400);
    }
    const anchor = await services.store.createExtensionPublisherTrustAnchor(body);
    await appendExtensionEvent(services, body.threadId, "extension.publisher.created", {
      trustAnchorId: anchor.id,
      keyId: anchor.keyId,
      algorithm: anchor.algorithm,
      status: anchor.status,
      signingCapable: Boolean(anchor.signingSource),
      anchorSha256: anchor.contentSha256,
    });
    setExtensionPublisherTrustAnchorHeaders(context, anchor);
    return context.json(anchor, 201);
  });

  app.post("/api/extensions/publishers/:anchorId/revoke", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_TRUST_ADMIN_REQUEST_BYTES, "Extension publisher trust anchor revocation request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseRevokeExtensionPublisherTrustAnchorRequest(input);
    if (!body) {
      return jsonError(context, "Extension publisher trust anchor revocation is invalid", 400);
    }
    services.store.getThread(body.threadId);
    const before = services.store.getExtensionPublisherTrustAnchor(context.req.param("anchorId"));
    const extensionRevisions = new Map(services.store.listExtensions().map((extension) => [extension.id, extension.revision]));
    const anchor = await services.store.revokeExtensionPublisherTrustAnchor(before.id);
    const affectedExtensionIds = services.store
      .listExtensions()
      .filter((extension) => extension.revision !== extensionRevisions.get(extension.id))
      .map((extension) => extension.id);
    await Promise.allSettled(affectedExtensionIds.map((extensionId) => services.extensions.closeTransport(extensionId)));
    if (before.status !== anchor.status) {
      await appendExtensionEvent(services, body.threadId, "extension.publisher.revoked", {
        trustAnchorId: anchor.id,
        keyId: anchor.keyId,
        status: anchor.status,
        anchorSha256: anchor.contentSha256,
        affectedExtensionIdsSha256: sha256Json(affectedExtensionIds.sort()),
        affectedExtensionCount: affectedExtensionIds.length,
      });
    }
    setExtensionPublisherTrustAnchorHeaders(context, anchor);
    return context.json(anchor);
  });

  app.post("/api/skills/packages/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES, "Skill package signing request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseSignSkillPackageRequest(input);
    if (!body) {
      return jsonError(context, "Skill package signing request is invalid", 400);
    }
    const envelope = await services.store.signSkillPackage(body);
    setSkillPackageHeaders(context, envelope, `napier-skill-package-${envelope.manifest.contentSha256.slice(0, 12)}.json`);
    await appendExtensionEvent(services, body.threadId, "skill.package.signed", {
      manifestSha256: envelope.manifest.contentSha256,
      envelopeSha256: envelope.contentSha256,
      skillCatalogSha256: envelope.manifest.skillCatalogSha256,
      skillCount: envelope.manifest.skills.length,
      keyId: envelope.signature.keyId,
      skillNamesSha256: sha256Json(envelope.manifest.loadedSkillNames),
    });
    return context.json(envelope);
  });

  app.post("/api/skills/packages/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_SKILL_PACKAGE_BYTES + 1_024, "Skill package verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Skill package verification request is invalid", 400);
    }
    const body = parseVerifySkillPackageRequest(input);
    if (!body) {
      return jsonError(context, "Skill package verification request is invalid", 400);
    }
    const verification = services.store.verifySkillPackage(body);
    setSkillPackageVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/skills/packages/qualify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_SKILL_PACKAGE_BYTES + 1_024, "Skill package qualification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Skill package qualification request is invalid", 400);
    }
    const body = parseQualifySkillPackageRequest(input);
    if (!body) {
      return jsonError(context, "Skill package qualification request is invalid", 400);
    }
    const qualification = await services.store.qualifySkillPackage(body);
    setSkillPackageQualificationHeaders(context, qualification);
    await appendExtensionEvent(services, body.threadId, "skill.package.qualified", {
      status: qualification.status,
      verificationStatus: qualification.verificationStatus,
      skillCount: qualification.skillCount,
      ...(qualification.manifestSha256 ? { manifestSha256: qualification.manifestSha256 } : {}),
      ...(qualification.envelopeSha256 ? { envelopeSha256: qualification.envelopeSha256 } : {}),
      ...(qualification.skillCatalogSha256 ? { skillCatalogSha256: qualification.skillCatalogSha256 } : {}),
      ...(qualification.observedSkillCatalogSha256
        ? {
            observedSkillCatalogSha256: qualification.observedSkillCatalogSha256,
          }
        : {}),
      ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
    });
    return context.json(qualification);
  });

  app.get("/api/skills/packages/installations", (context) => {
    const installations = services.store.listSkillPackageInstallations();
    setSkillPackageInstallationListHeaders(context, installations);
    return context.json(installations);
  });

  app.post("/api/skills/packages/installations", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_SKILL_PACKAGE_BYTES + 1_024, "Skill package installation request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Skill package installation request is invalid", 400);
    }
    const body = parseInstallSkillPackageRequest(input);
    if (!body) {
      return jsonError(context, "Skill package installation request is invalid", 400);
    }
    const result = await services.store.installSkillPackage(body);
    setSkillPackageInstallationResultHeaders(context, result);
    await appendExtensionEvent(services, body.threadId, result.created ? "skill.package.installed" : "skill.package.installation_matched", {
      installationId: result.installation.id,
      status: result.installation.status,
      created: result.created,
      publisher: result.installation.publisher,
      keyId: result.installation.keyId,
      skillCatalogSha256: result.installation.skillCatalogSha256,
      manifestSha256: result.installation.manifestSha256,
      envelopeSha256: result.installation.envelopeSha256,
      skillNamesSha256: result.installation.skillNamesSha256,
      skillCount: result.installation.loadedSkillNames.length,
      ...(result.replacedInstallation
        ? {
            replacedInstallationId: result.replacedInstallation.id,
            publisherChanged: result.replacedInstallation.publisher !== result.installation.publisher || result.replacedInstallation.keyId !== result.installation.keyId,
            skillSetChanged: result.replacedInstallation.skillNamesSha256 !== result.installation.skillNamesSha256,
          }
        : {}),
    });
    return context.json(result);
  });

  app.post("/api/skills/content/preview", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SKILL_CONTENT_BYTES * 2 + 4_096, "Skill content preview request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Skill content preview request is invalid", 400);
    }
    const body = parsePreviewSkillContentRequest(input);
    if (!body) {
      return jsonError(context, "Skill content preview request is invalid", 400);
    }
    const review = await services.store.previewSkillContent(body);
    setSkillContentReviewHeaders(context, review);
    return context.json(review);
  });

  app.post("/api/skills/content/apply", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SKILL_CONTENT_BYTES * 2 + 4_096, "Skill content apply request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Skill content apply request is invalid", 400);
    }
    const body = parseApplySkillContentRequest(input);
    if (!body) {
      return jsonError(context, "Skill content apply request is invalid", 400);
    }
    const result = await services.store.applySkillContent(body);
    setSkillContentApplyResultHeaders(context, result);
    await appendExtensionEvent(services, body.threadId, result.review.action === "noop" ? "skill.content.noop" : result.review.action === "install" ? "skill.content.installed" : "skill.content.replaced", {
      applied: result.applied,
      skillName: result.review.skillName,
      relativePath: result.review.relativePath,
      action: result.review.action,
      reviewSha256: result.review.reviewSha256,
      contentSha256: result.review.contentSha256,
      frontmatterSha256: result.review.frontmatterSha256,
      bodySha256: result.review.bodySha256,
      sizeBytes: result.review.sizeBytes,
      lineCount: result.review.lineCount,
      ...(result.review.currentContentSha256 ? { currentContentSha256: result.review.currentContentSha256 } : {}),
      ...(result.review.currentSizeBytes !== undefined ? { currentSizeBytes: result.review.currentSizeBytes } : {}),
      ...(result.review.currentLineCount !== undefined ? { currentLineCount: result.review.currentLineCount } : {}),
    });
    return context.json(result);
  });

  app.post("/api/prompts/packages/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES, "Prompt package signing request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseSignPromptPackageRequest(input);
    if (!body) {
      return jsonError(context, "Prompt package signing request is invalid", 400);
    }
    const envelope = services.store.signPromptPackage(body);
    setPromptPackageHeaders(context, envelope, `napier-prompt-package-${envelope.manifest.contentSha256.slice(0, 12)}.json`);
    await appendExtensionEvent(services, body.threadId, "prompt.package.signed", {
      manifestSha256: envelope.manifest.contentSha256,
      envelopeSha256: envelope.contentSha256,
      systemPromptSha256: envelope.manifest.systemPromptSha256,
      agentId: envelope.manifest.sourceAgentId,
      agentRevision: envelope.manifest.agentRevision,
      keyId: envelope.signature.keyId,
    });
    return context.json(envelope);
  });

  app.post("/api/prompts/packages/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_PROMPT_PACKAGE_BYTES + 1_024, "Prompt package verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Prompt package verification request is invalid", 400);
    }
    const body = parseVerifyPromptPackageRequest(input);
    if (!body) {
      return jsonError(context, "Prompt package verification request is invalid", 400);
    }
    const verification = services.store.verifyPromptPackage(body);
    setPromptPackageVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/prompts/packages/qualify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_PROMPT_PACKAGE_BYTES + 1_024, "Prompt package qualification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Prompt package qualification request is invalid", 400);
    }
    const body = parseQualifyPromptPackageRequest(input);
    if (!body) {
      return jsonError(context, "Prompt package qualification request is invalid", 400);
    }
    const qualification = services.store.qualifyPromptPackage(body);
    setPromptPackageQualificationHeaders(context, qualification);
    await appendExtensionEvent(services, body.threadId, "prompt.package.qualified", {
      status: qualification.status,
      verificationStatus: qualification.verificationStatus,
      ...(qualification.manifestSha256 ? { manifestSha256: qualification.manifestSha256 } : {}),
      ...(qualification.envelopeSha256 ? { envelopeSha256: qualification.envelopeSha256 } : {}),
      ...(qualification.systemPromptSha256 ? { systemPromptSha256: qualification.systemPromptSha256 } : {}),
      ...(qualification.observedSystemPromptSha256
        ? {
            observedSystemPromptSha256: qualification.observedSystemPromptSha256,
          }
        : {}),
      ...(qualification.observedAgentId ? { observedAgentId: qualification.observedAgentId } : {}),
      ...(qualification.observedAgentRevision ? { observedAgentRevision: qualification.observedAgentRevision } : {}),
      ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
    });
    return context.json(qualification);
  });

  app.post("/api/inspectors/packages/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES, "Inspector package signing request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseSignInspectorPackageRequest(input);
    if (!body) {
      return jsonError(context, "Inspector package signing request is invalid", 400);
    }
    const envelope = services.store.signInspectorPackage(body);
    setInspectorPackageHeaders(context, envelope, `napier-inspector-package-${envelope.manifest.contentSha256.slice(0, 12)}.json`);
    await appendExtensionEvent(services, body.threadId, "inspector.package.signed", {
      manifestSha256: envelope.manifest.contentSha256,
      envelopeSha256: envelope.contentSha256,
      inspectorCatalogSha256: envelope.manifest.inspectorCatalogSha256,
      panelCount: envelope.manifest.panels.length,
      keyId: envelope.signature.keyId,
      panelIdsSha256: sha256Json(envelope.manifest.panels.map((panel) => panel.id)),
    });
    return context.json(envelope);
  });

  app.post("/api/inspectors/packages/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_INSPECTOR_PACKAGE_BYTES + 1_024, "Inspector package verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Inspector package verification request is invalid", 400);
    }
    const body = parseVerifyInspectorPackageRequest(input);
    if (!body) {
      return jsonError(context, "Inspector package verification request is invalid", 400);
    }
    const verification = services.store.verifyInspectorPackage(body);
    setInspectorPackageVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/inspectors/packages/qualify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_INSPECTOR_PACKAGE_BYTES + 1_024, "Inspector package qualification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Inspector package qualification request is invalid", 400);
    }
    const body = parseQualifyInspectorPackageRequest(input);
    if (!body) {
      return jsonError(context, "Inspector package qualification request is invalid", 400);
    }
    const qualification = services.store.qualifyInspectorPackage(body);
    setInspectorPackageQualificationHeaders(context, qualification);
    await appendExtensionEvent(services, body.threadId, "inspector.package.qualified", {
      status: qualification.status,
      verificationStatus: qualification.verificationStatus,
      panelCount: qualification.panelCount,
      ...(qualification.manifestSha256 ? { manifestSha256: qualification.manifestSha256 } : {}),
      ...(qualification.envelopeSha256 ? { envelopeSha256: qualification.envelopeSha256 } : {}),
      ...(qualification.inspectorCatalogSha256 ? { inspectorCatalogSha256: qualification.inspectorCatalogSha256 } : {}),
      ...(qualification.observedInspectorCatalogSha256
        ? {
            observedInspectorCatalogSha256: qualification.observedInspectorCatalogSha256,
          }
        : {}),
      ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
    });
    return context.json(qualification);
  });

  app.post("/api/extensions/:extensionId/package/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES, "Extension package signing request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseSignExtensionPackageRequest(input);
    if (!body) {
      return jsonError(context, "Extension package signing request is invalid", 400);
    }
    const extension = services.store.getExtension(context.req.param("extensionId"));
    const envelope = await services.store.signExtensionPackage(extension.id, body);
    setSignedExtensionPackageHeaders(context, envelope, extension.normalizedName);
    await appendExtensionEvent(services, body.threadId, "extension.package.signed", signedExtensionPackageEventPayload(extension.id, envelope));
    return context.json(envelope);
  });

  app.post("/api/extensions/packages/deployment/preview", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES + 131_072, "Signed Extension package deployment preview request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Signed Extension package deployment preview request is invalid", 400);
    }
    const body = parsePreviewExtensionPackageDeploymentRequest(input);
    if (!body) {
      return jsonError(context, "Signed Extension package deployment preview request is invalid", 400);
    }
    const preview = services.store.previewExtensionPackageDeployment(body.envelopes);
    setExtensionPackageDeploymentPreviewHeaders(context, preview);
    return context.json(preview);
  });

  app.post("/api/extensions/packages/deployment", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_EXTENSION_PACKAGE_DEPLOYMENT_BYTES + 131_072, "Signed Extension package deployment request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Signed Extension package deployment request is invalid", 400);
    }
    const body = parseApplyExtensionPackageDeploymentRequest(input);
    if (!body) {
      return jsonError(context, "Signed Extension package deployment request is invalid", 400);
    }
    const result = await services.store.applyExtensionPackageDeployment(body);
    await Promise.allSettled(result.updatedExtensionIds.map((extensionId) => services.extensions.closeTransport(extensionId)));
    if (result.extensions.length > 0) {
      await appendExtensionEvent(services, body.threadId, "extension.packages.deployed", {
        deploymentSha256: result.preview.contentSha256,
        candidateCount: result.preview.candidateCount,
        installCount: result.installedExtensionIds.length,
        updateCount: result.updatedExtensionIds.length,
        installedExtensionIdsSha256: sha256Json([...result.installedExtensionIds].sort()),
        updatedExtensionIdsSha256: sha256Json([...result.updatedExtensionIds].sort()),
        candidateEnvelopeIdsSha256: sha256Json(result.preview.items.map((item) => item.next.envelopeSha256).sort()),
        applyOrderSha256: sha256Json(result.preview.applyOrder),
        dependencyResolutionSha256: sha256Json(
          result.preview.resolutions.map((resolution) => ({
            dependentName: resolution.dependentName,
            dependencyName: resolution.dependencyName,
            versionRange: resolution.versionRange,
            resolvedVersion: resolution.resolvedVersion,
            resolvedExtensionId: resolution.resolvedExtensionId ?? "",
            source: resolution.source,
          })),
        ),
      });
    }
    setExtensionPackageDeploymentResultHeaders(context, result);
    return context.json(result);
  });

  app.post("/api/extensions/packages/lockfile/export", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES, "Extension package lockfile export request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseExportExtensionPackageLockfileRequest(input);
    if (!body) {
      return jsonError(context, "Extension package lockfile export request is invalid", 400);
    }
    const lockfile = services.store.exportExtensionPackageLockfile(body);
    setExtensionPackageLockfileHeaders(context, lockfile, `napier-extension-lockfile-${lockfile.contentSha256.slice(0, 12)}.json`);
    await appendExtensionEvent(services, body.threadId, "extension.packages.lockfile.exported", {
      lockfileSha256: lockfile.contentSha256,
      packageCount: lockfile.packages.length,
      packageEnvelopeIdsSha256: sha256Json(lockfile.packages.map((entry) => entry.envelopeSha256).sort()),
      dependencyCount: lockfile.packages.reduce((total, entry) => total + entry.dependencies.length, 0),
    });
    return context.json(lockfile);
  });

  app.get("/api/extensions/packages/lockfiles/:lockfileSha256", async (context) => {
    const lockfileSha256 = context.req.param("lockfileSha256");
    if (!/^[a-f0-9]{64}$/.test(lockfileSha256)) {
      return jsonError(context, "Extension package lockfile hash is invalid", 400);
    }
    try {
      const lockfile = services.store.getExtensionPackageRolloutLockfile(lockfileSha256);
      setExtensionPackageLockfileHeaders(context, lockfile, `napier-extension-lockfile-${lockfile.contentSha256.slice(0, 12)}.json`);
      return context.json(lockfile);
    } catch (error) {
      return jsonError(context, errorMessage(error), 404);
    }
  });

  app.post("/api/extensions/packages/lockfile/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_EXTENSION_PACKAGE_LOCKFILE_BYTES + 16_384, "Extension package lockfile verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Extension package lockfile verification request is invalid", 400);
    }
    const body = parseVerifyExtensionPackageLockfileRequest(input);
    if (!body) {
      return jsonError(context, "Extension package lockfile verification request is invalid", 400);
    }
    const verification = services.store.verifyExtensionPackageLockfile(body.lockfile);
    setExtensionPackageLockfileVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/extensions/packages/channel-index/sign", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES, "Extension package channel index signing request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parseSignExtensionPackageChannelIndexRequest(input);
    if (!body) {
      return jsonError(context, "Extension package channel index signing request is invalid", 400);
    }
    const envelope = await services.store.signExtensionPackageChannelIndex(body);
    setExtensionPackageChannelIndexHeaders(context, envelope, `napier-channel-index-${envelope.index.contentSha256.slice(0, 12)}.json`);
    await appendExtensionEvent(services, body.threadId, "extension.packages.channel_index.signed", {
      indexSha256: envelope.index.contentSha256,
      envelopeSha256: envelope.contentSha256,
      channelCount: envelope.index.channels.length,
      keyId: envelope.signature.keyId,
      channelNamesSha256: sha256Json(envelope.index.channels.map((entry) => entry.normalizedName).sort()),
    });
    return context.json(envelope);
  });

  app.post("/api/extensions/packages/channel-index/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_EXTENSION_PACKAGE_CHANNEL_INDEX_BYTES + 16_384, "Extension package channel index verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Extension package channel index verification request is invalid", 400);
    }
    const body = parseVerifyExtensionPackageChannelIndexRequest(input);
    if (!body) {
      return jsonError(context, "Extension package channel index verification request is invalid", 400);
    }
    const verification = services.store.verifyExtensionPackageChannelIndex(body);
    setExtensionPackageChannelIndexVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.get("/api/extensions/packages/rollouts", (context) => {
    const channels = services.store.listExtensionPackageRolloutChannels();
    setExtensionPackageRolloutChannelListHeaders(context, channels);
    return context.json(channels);
  });

  app.post("/api/extensions/packages/rollouts", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES, "Extension package rollout channel request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const body = parsePublishExtensionPackageRolloutChannelRequest(input);
    if (!body) {
      return jsonError(context, "Extension package rollout channel request is invalid", 400);
    }
    const channel = await services.store.publishExtensionPackageRolloutChannel(body);
    await appendExtensionEvent(services, body.threadId, "extension.packages.rollout.published", {
      channelId: channel.id,
      name: channel.name,
      normalizedName: channel.normalizedName,
      revision: channel.revision,
      lockfileSha256: channel.lockfileSha256,
      packageCount: channel.packageCount,
      dependencyCount: channel.dependencyCount,
      packageEnvelopeIdsSha256: channel.packageEnvelopeIdsSha256,
      policySha256: sha256Json({
        maxPackages: channel.policy.maxPackages,
        allowedPublisherKeyIds: channel.policy.allowedPublisherKeyIds,
        allowedPackageNames: channel.policy.allowedPackageNames,
        requireTrustedPublishers: channel.policy.requireTrustedPublishers,
        requireDependencyClosure: channel.policy.requireDependencyClosure,
      }),
    });
    setExtensionPackageRolloutChannelHeaders(context, channel);
    return context.json(channel, channel.revision === 1 ? 201 : 200);
  });

  app.post("/api/extensions/packages/rollouts/:channelId/preview", (context) => {
    const body = parsePreviewExtensionPackageRolloutChannelRequest({
      channelId: context.req.param("channelId"),
    });
    if (!body) {
      return jsonError(context, "Extension package rollout channel preview request is invalid", 400);
    }
    const preview = services.store.previewExtensionPackageRolloutChannel(body);
    setExtensionPackageRolloutPreviewHeaders(context, preview);
    return context.json(preview);
  });

  app.post("/api/extensions/packages/rollouts/:channelId", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES, "Extension package rollout channel apply request");
    } catch (error) {
      return jsonError(context, errorMessage(error), error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
    const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const body = parseApplyExtensionPackageRolloutChannelRequest({
      ...record,
      channelId: context.req.param("channelId"),
    });
    if (!body) {
      return jsonError(context, "Extension package rollout channel apply request is invalid", 400);
    }
    const result = await services.store.applyExtensionPackageRolloutChannel(body);
    await Promise.allSettled(result.deployment.updatedExtensionIds.map((extensionId) => services.extensions.closeTransport(extensionId)));
    if (result.deployment.extensions.length > 0) {
      await appendExtensionEvent(services, body.threadId, "extension.packages.rollout.applied", {
        channelId: result.channel.id,
        channelRevision: result.channel.revision,
        rolloutSha256: result.rolloutPreview.contentSha256,
        deploymentSha256: result.deployment.preview.contentSha256,
        lockfileSha256: result.channel.lockfileSha256,
        installCount: result.deployment.installedExtensionIds.length,
        updateCount: result.deployment.updatedExtensionIds.length,
        installedExtensionIdsSha256: sha256Json([...result.deployment.installedExtensionIds].sort()),
        updatedExtensionIdsSha256: sha256Json([...result.deployment.updatedExtensionIds].sort()),
        packageEnvelopeIdsSha256: result.channel.packageEnvelopeIdsSha256,
      });
    }
    setExtensionPackageRolloutApplyResultHeaders(context, result);
    return context.json(result);
  });

  app.post("/api/extensions/:extensionId/package/update/preview", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_EXTENSION_PACKAGE_BYTES + 16_384, "Signed Extension package update preview request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Signed Extension package update preview request is invalid", 400);
    }
    const body = parsePreviewExtensionPackageUpdateRequest(input);
    if (!body) {
      return jsonError(context, "Signed Extension package update preview request is invalid", 400);
    }
    const preview = services.store.previewExtensionPackageUpdate(context.req.param("extensionId"), body.envelope);
    setExtensionPackageUpdatePreviewHeaders(context, preview);
    return context.json(preview);
  });

  app.post("/api/extensions/:extensionId/package/update", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_EXTENSION_PACKAGE_BYTES + 16_384, "Signed Extension package update request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Signed Extension package update request is invalid", 400);
    }
    const body = parseApplyExtensionPackageUpdateRequest(input);
    if (!body) {
      return jsonError(context, "Signed Extension package update request is invalid", 400);
    }
    const extensionId = context.req.param("extensionId");
    const result = await services.store.applyExtensionPackageUpdate(extensionId, body);
    if (result.updated) {
      await services.extensions.closeTransport(extensionId);
      await appendExtensionEvent(services, body.threadId, "extension.package.updated", {
        extensionId,
        expectedPackageBindingSha256: result.preview.expectedPackageBindingSha256,
        currentManifestSha256: result.preview.current.manifestSha256,
        currentEnvelopeSha256: result.preview.current.envelopeSha256,
        nextManifestSha256: result.preview.next.manifestSha256,
        nextEnvelopeSha256: result.preview.next.envelopeSha256,
        previewSha256: result.preview.contentSha256,
        versionDirection: result.preview.versionDirection,
        publisherChanged: result.preview.publisherChanged,
        changeKinds: result.preview.changes,
        packageHistoryCount: result.extension.packageHistory?.length ?? 0,
      });
    }
    setExtensionPackageUpdateResultHeaders(context, result);
    return context.json(result);
  });

  app.post("/api/extensions/packages/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_EXTENSION_PACKAGE_BYTES + 16_384, "Signed Extension package verification request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Signed Extension package verification request is invalid", 400);
    }
    const body = parseVerifySignedExtensionPackageRequest(input);
    if (!body) {
      return jsonError(context, "Signed Extension package verification request is invalid", 400);
    }
    const verification = verifySignedExtensionPackageEnvelope(body.envelope, services.store.listExtensionPublisherTrustAnchors());
    setExtensionPackageVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/extensions/packages/import", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(context.req.raw, MAX_SIGNED_EXTENSION_PACKAGE_BYTES + 16_384, "Signed Extension package import request");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Signed Extension package import request is invalid", 400);
    }
    const body = parseImportSignedExtensionPackageRequest(input);
    if (!body) {
      return jsonError(context, "Signed Extension package import request is invalid", 400);
    }
    const extension = await services.store.importSignedExtensionPackage(body);
    const packageBinding = extension.packageBinding;
    if (!packageBinding) {
      throw new Error("Signed Extension import did not produce a package binding");
    }
    await appendExtensionEvent(services, body.threadId, "extension.package.imported", {
      ...signedExtensionPackageEventPayload(extension.id, packageBinding.envelope),
      packageBindingSha256: packageBinding.contentSha256,
    });
    setExtensionRecordHeaders(context, extension);
    return context.json(extension, 201);
  });

  registerExtensionLifecycleHttp(app, services);

  registerThreadControlHttp(app, services);
  registerThreadExecutionHttp(app, services);
  registerThreadWorkflowHttp(app, services);

  app.notFound((context) => {
    const pathname = new URL(context.req.url).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return jsonError(context, `API route not found: ${pathname}`, 404);
    }
    return context.text("Not Found", 404);
  });

  app.onError((error, context) => {
    const status = error.message.includes("not found") ? 404 : isReceiptTrustConflict(error) ? 409 : isExtensionPackageConflict(error) ? 409 : isSkillPackageConflict(error) ? 409 : isSkillContentConflict(error) ? 409 : isPlanConflict(error) ? 409 : isReceiptTrustClientError(error) ? 400 : isExtensionPackageClientError(error) ? 400 : isSkillContentClientError(error) ? 400 : isPlanClientError(error) ? 400 : 500;
    return jsonError(context, error.message, status);
  });

  return app;
}

export async function readProductionIndex(): Promise<string | undefined> {
  try {
    return await readFile(path.resolve(process.cwd(), "apps/web/dist/index.html"), "utf8");
  } catch {
    return undefined;
  }
}
