import {
  NAPIER_API_VERSION,
  type ExecutionPlanBlueprintPortfolioCalibration,
  type ExecutionPlanBlueprintRecommendationPolicyBacktest,
  type ExecutionPlanBlueprintRecommendationPolicySource,
  type ExecutionPlanBlueprintRecord,
  type ExecutionPlanBlueprintRecordOutcomeBaseline,
  type ExecutionPlanBlueprintRecordOutcomeQualification,
  type ExecutionPlanBlueprintRecordPreview,
  type ExecutionPlanBlueprintRecordQualification,
  type ExecutionPlanBlueprintRecordSelection,
  type PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  type PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  type SelectExecutionPlanBlueprintRecordRequest
} from "@napier/contracts";
import {
  createExecutionPlanBlueprintOutcomeBaseline
} from "./execution-plan-blueprint-outcome-baseline.js";
import {
  createExecutionPlanBlueprintOutcomeQualification,
  DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE,
  executionPlanBlueprintOutcomePolicyDiagnostics,
  normalizeExecutionPlanBlueprintOutcomeBaselinePolicy,
  normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate,
} from "./execution-plan-blueprint-outcome-policy.js";
import { createExecutionPlanBlueprintOutcomeBaselineReviewEvidence } from "./execution-plan-blueprint-outcome-review-evidence.js";
import {
  verifyExecutionPlanBlueprintRecordReplayOutcomesProjection
} from "./execution-plan-blueprint-replay-verification.js";
import { createId,nowIso } from "./ids.js";
import { createExecutionPlanBlueprintRecommendationPolicyBacktest } from "./plan-blueprint-backtest.js";
import { compareExecutionPlanBlueprintRecords,createExecutionPlanBlueprintPortfolioCalibrationEntry,createExecutionPlanBlueprintPortfolioCalibrationFamilies,executionPlanBlueprintPortfolioSetSha256,listExecutionPlanBlueprintRecommendationPolicies,normalizeExecutionPlanBlueprintRecommendationPolicy,normalizeExecutionPlanBlueprintSelectionObjective,validateExecutionPlanBlueprintRecommendationPolicyOverride,type ExecutionPlanBlueprintPortfolioCalibrationEntry } from "./plan-blueprint-portfolio-model.js";
import { createExecutionPlanBlueprintRecordSelection,createExecutionPlanBlueprintSelectionCandidate,selectExecutionPlanBlueprintCandidate } from "./plan-blueprint-selection.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

function createExecutionPlanBlueprintPortfolioCalibration(
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[],
): ExecutionPlanBlueprintPortfolioCalibration {
  const families =
    createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
  const content = {
    kind: "napier.execution-plan-blueprint-portfolio-calibration" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    recordCount: entries.length,
    activeCount: entries.filter((entry) => entry.recordStatus === "active")
      .length,
    archivedCount: entries.filter((entry) => entry.recordStatus === "archived")
      .length,
    familyCount: families.length,
    sourceQualifiedCount: entries.filter(
      (entry) => entry.sourceQualificationStatus === "qualified",
    ).length,
    outcomeQualifiedCount: entries.filter(
      (entry) => entry.outcomeQualificationStatus === "qualified",
    ).length,
    reviewedBaselineCount: entries.filter((entry) => entry.reviewedBaseline)
      .length,
    missingBaselineCount: entries.filter(
      (entry) => entry.outcomeQualificationStatus === "missing_baseline",
    ).length,
    policyFailedCount: entries.filter(
      (entry) => entry.outcomeQualificationStatus === "policy_failed",
    ).length,
    portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
    families,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export class PlanBlueprintOutcomeRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listExecutionPlanBlueprintRecordOutcomeBaselines(
      recordId: string,
    ): ExecutionPlanBlueprintRecordOutcomeBaseline[] {
      this.host.assertInitialized();
      this.host.getExecutionPlanBlueprintRecord(recordId);
      return structuredClone(
        this.host.state.executionPlanBlueprintOutcomeBaselines
          .filter((baseline) => baseline.recordId === recordId)
          .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt)),
      );
    }

  async promoteExecutionPlanBlueprintRecordOutcomeBaseline(
      recordId: string,
      request: PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
    ): Promise<PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult> {
      this.host.assertInitialized();
      this.host.getExecutionPlanBlueprintRecord(recordId);
      const policy = normalizeExecutionPlanBlueprintOutcomeBaselinePolicy(
        request.policy,
      );
      const observed =
        await this.host.getExecutionPlanBlueprintRecordReplayOutcomes(recordId);
      const verification =
        verifyExecutionPlanBlueprintRecordReplayOutcomesProjection(
          request.outcomes,
          recordId,
          observed,
        );
      if (verification.status !== "valid") {
        throw new Error(
          "Execution plan blueprint outcome baseline requires current outcomes",
        );
      }
      const policyDiagnostics = executionPlanBlueprintOutcomePolicyDiagnostics(
        observed,
        policy,
      );
      if (policyDiagnostics.length > 0) {
        throw new Error(
          `Execution plan blueprint outcome baseline policy failed: ${policyDiagnostics.join(",")}`,
        );
      }
      const hasReview = request.review !== undefined;
      const reviewGate =
        hasReview || request.reviewGate !== undefined
          ? normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate(
              request.reviewGate,
            )
          : undefined;
      if (reviewGate && !hasReview) {
        throw new Error(
          "Execution plan blueprint outcome baseline requires reviewed outcomes",
        );
      }
      const reviewEvidence = hasReview
        ? createExecutionPlanBlueprintOutcomeBaselineReviewEvidence({
            recordId,
            review: request.review,
            outcomes: observed,
            sourceQualification:
              await this.host.qualifyExecutionPlanBlueprintRecord(recordId),
            outcomeQualification:
              await this.host.qualifyExecutionPlanBlueprintRecordOutcomes(recordId),
            reviewGate:
              reviewGate ??
              DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE,
          })
        : undefined;
      return this.host.stateQueue.run(async () => {
        const latest = this.host.state.executionPlanBlueprintOutcomeBaselines
          .filter((baseline) => baseline.recordId === recordId)
          .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt))
          .at(-1);
        if (
          latest &&
          latest.replayOutcomesSha256 === observed.contentSha256 &&
          JSON.stringify(latest.policy) === JSON.stringify(policy) &&
          (latest.reviewSha256 ?? "") === (reviewEvidence?.reviewSha256 ?? "") &&
          JSON.stringify(latest.reviewGate ?? null) ===
            JSON.stringify(reviewEvidence?.reviewGate ?? null)
        ) {
          return {
            baseline: structuredClone(latest),
            created: false,
          };
        }
        const baseline = createExecutionPlanBlueprintOutcomeBaseline({
          id: createId("outcome_base"),
          recordId,
          outcomes: observed,
          policy,
          ...(reviewEvidence ? { reviewEvidence } : {}),
          promotedAt: nowIso(),
          ...(latest ? { supersedesBaselineId: latest.id } : {}),
        });
        this.host.state.executionPlanBlueprintOutcomeBaselines.push(baseline);
        await this.host.persistState();
        return {
          baseline: structuredClone(baseline),
          created: true,
        };
      });
    }

  async qualifyExecutionPlanBlueprintRecordOutcomes(
      recordId: string,
    ): Promise<ExecutionPlanBlueprintRecordOutcomeQualification> {
      this.host.assertInitialized();
      this.host.getExecutionPlanBlueprintRecord(recordId);
      const outcomes =
        await this.host.getExecutionPlanBlueprintRecordReplayOutcomes(recordId);
      const latest = this.host.state.executionPlanBlueprintOutcomeBaselines
        .filter((baseline) => baseline.recordId === recordId)
        .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt))
        .at(-1);
      return createExecutionPlanBlueprintOutcomeQualification(
        recordId,
        outcomes,
        latest,
      );
    }

  async selectExecutionPlanBlueprintRecord(
      threadId: string,
      request: SelectExecutionPlanBlueprintRecordRequest = {},
    ): Promise<ExecutionPlanBlueprintRecordSelection> {
      this.host.assertInitialized();
      this.host.getThread(threadId);
      const objective = normalizeExecutionPlanBlueprintSelectionObjective(
        request.objective,
      );
      const recommendationPolicy =
        normalizeExecutionPlanBlueprintRecommendationPolicy(
          request.policyTemplate,
        );
      const policyOverrides =
        this.host.state.executionPlanBlueprintRecommendationPolicyOverrides.map(
          validateExecutionPlanBlueprintRecommendationPolicyOverride,
        );
      const policyOverrideByFamilySha256 = new Map(
        policyOverrides.map((override) => [override.familySha256, override]),
      );
      const candidateInputs: Array<{
        record: ExecutionPlanBlueprintRecord;
        sourceQualification: ExecutionPlanBlueprintRecordQualification;
        outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
        latestBaseline?: ExecutionPlanBlueprintRecordOutcomeBaseline;
        preview?: ExecutionPlanBlueprintRecordPreview;
        entry: ExecutionPlanBlueprintPortfolioCalibrationEntry;
      }> = [];
      const entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[] = [];
      const records = [...this.host.state.executionPlanBlueprints].sort(
        compareExecutionPlanBlueprintRecords,
      );
      for (const record of records) {
        const sourceQualification =
          await this.host.qualifyExecutionPlanBlueprintRecord(record.id);
        const outcomeQualification =
          await this.host.qualifyExecutionPlanBlueprintRecordOutcomes(record.id);
        const latestBaseline = this.host.state.executionPlanBlueprintOutcomeBaselines
          .filter((baseline) => baseline.recordId === record.id)
          .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt))
          .at(-1);
        const preview =
          sourceQualification.status === "qualified" &&
          outcomeQualification.status === "qualified"
            ? await this.host.previewPlanFromBlueprintRecord(threadId, {
                recordId: record.id,
                ...(objective ? { objective } : {}),
              })
            : undefined;
        const entry = createExecutionPlanBlueprintPortfolioCalibrationEntry({
          record,
          sourceQualification,
          outcomeQualification,
          ...(latestBaseline ? { latestBaseline } : {}),
        });
        entries.push(entry);
        candidateInputs.push({
          record,
          sourceQualification,
          outcomeQualification,
          entry,
          ...(latestBaseline ? { latestBaseline } : {}),
          ...(preview ? { preview } : {}),
        });
      }
      const families =
        createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
      const familyBySha256 = new Map(
        families.map((family) => [family.familySha256, family]),
      );
      const candidates = candidateInputs.map((input) => {
        const family = familyBySha256.get(input.entry.familySha256);
        if (!family) {
          throw new Error("Execution plan blueprint portfolio family missing");
        }
        const familyPolicyOverride =
          request.policyTemplate === undefined
            ? policyOverrideByFamilySha256.get(family.familySha256)
            : undefined;
        const candidateRecommendationPolicy =
          familyPolicyOverride?.recommendationPolicy ?? recommendationPolicy;
        const recommendationPolicySource: ExecutionPlanBlueprintRecommendationPolicySource =
          request.policyTemplate !== undefined
            ? "request"
            : familyPolicyOverride
              ? "family_override"
              : "default";
        return createExecutionPlanBlueprintSelectionCandidate({
          record: input.record,
          sourceQualification: input.sourceQualification,
          outcomeQualification: input.outcomeQualification,
          family,
          recommendationPolicy: candidateRecommendationPolicy,
          recommendationPolicySource,
          ...(familyPolicyOverride
            ? { familyPolicyOverrideSha256: familyPolicyOverride.contentSha256 }
            : {}),
          ...(input.latestBaseline
            ? { latestBaseline: input.latestBaseline }
            : {}),
          ...(input.preview ? { preview: input.preview } : {}),
        });
      });
      const selected = selectExecutionPlanBlueprintCandidate(candidates);
      const selectedCandidates = candidates.map((candidate) =>
        selected && candidate.recordId === selected.recordId
          ? { ...candidate, selectionStatus: "selected" as const }
          : candidate,
      );
      return createExecutionPlanBlueprintRecordSelection({
        threadId,
        candidates: selectedCandidates,
        recommendationPolicy,
        familyPolicyOverrides: policyOverrides,
        portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
        ...(objective ? { objective } : {}),
      });
    }

  async calibrateExecutionPlanBlueprintPortfolio(): Promise<ExecutionPlanBlueprintPortfolioCalibration> {
      this.host.assertInitialized();
      const entries =
        await this.host.listExecutionPlanBlueprintPortfolioCalibrationEntries();
      return createExecutionPlanBlueprintPortfolioCalibration(entries);
    }

  async backtestExecutionPlanBlueprintRecommendationPolicies(): Promise<ExecutionPlanBlueprintRecommendationPolicyBacktest> {
      this.host.assertInitialized();
      const entries =
        await this.host.listExecutionPlanBlueprintPortfolioCalibrationEntries();
      const families =
        createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
      return createExecutionPlanBlueprintRecommendationPolicyBacktest({
        entries,
        families,
        policies: listExecutionPlanBlueprintRecommendationPolicies(),
        portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
      });
    }
}
