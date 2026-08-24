import {
  type ExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideList,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  type RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  type RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  type SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import { createExecutionPlanBlueprintRecommendationPolicyOverride,createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,createExecutionPlanBlueprintRecommendationPolicyOverrideList } from "./plan-blueprint-policy-override-model.js";
import { createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle } from "./plan-blueprint-policy-proof.js";
import { createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult,verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProjection } from "./plan-blueprint-policy-retirement.js";
import {
  compareExecutionPlanBlueprintRecords,
  createExecutionPlanBlueprintPortfolioCalibrationEntry,
  createExecutionPlanBlueprintPortfolioCalibrationFamilies,
  executionPlanBlueprintPortfolioSetSha256,
  executionPlanBlueprintRecommendationPolicyOverrideSetSha256,
  isSha256,
  listExecutionPlanBlueprintRecommendationPolicies,
  normalizeExecutionPlanBlueprintRecommendationPolicy,
  validateExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintPortfolioCalibrationEntry,
} from "./plan-blueprint-portfolio-model.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export class PlanBlueprintPolicyRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async listExecutionPlanBlueprintRecommendationPolicyOverrides(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideList> {
      this.host.assertInitialized();
      const entries =
        await this.host.listExecutionPlanBlueprintPortfolioCalibrationEntries();
      return createExecutionPlanBlueprintRecommendationPolicyOverrideList({
        overrides: this.host.state.executionPlanBlueprintRecommendationPolicyOverrides,
        portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
      });
    }

  async reviewExecutionPlanBlueprintRecommendationPolicyOverrideDrift(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview> {
      this.host.assertInitialized();
      const entries =
        await this.host.listExecutionPlanBlueprintPortfolioCalibrationEntries();
      const families =
        createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
      const overrides =
        this.host.state.executionPlanBlueprintRecommendationPolicyOverrides.map(
          validateExecutionPlanBlueprintRecommendationPolicyOverride,
        );
      return createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview({
        entries,
        families,
        overrides,
        policies: listExecutionPlanBlueprintRecommendationPolicies(),
        portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
      });
    }

  async listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory> {
      this.host.assertInitialized();
      const entries =
        await this.host.listExecutionPlanBlueprintPortfolioCalibrationEntries();
      const overrides =
        this.host.state.executionPlanBlueprintRecommendationPolicyOverrides.map(
          validateExecutionPlanBlueprintRecommendationPolicyOverride,
        );
      return createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory(
        {
          retirements:
            this.host.state
              .executionPlanBlueprintRecommendationPolicyOverrideRetirements,
          portfolioSetSha256: executionPlanBlueprintPortfolioSetSha256(entries),
          currentOverrideSetSha256:
            executionPlanBlueprintRecommendationPolicyOverrideSetSha256(
              overrides,
            ),
        },
      );
    }

  async verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
      input: unknown,
    ): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification> {
      this.host.assertInitialized();
      const observed =
        await this.host.listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements();
      return verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProjection(
        input,
        observed,
      );
    }

  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
      histories: unknown[],
    ): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle {
      this.host.assertInitialized();
      return createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle(
        histories,
      );
    }

  async setExecutionPlanBlueprintRecommendationPolicyOverride(
      request: SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
    ): Promise<ExecutionPlanBlueprintRecommendationPolicyOverride> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        if (!isSha256(request.familySha256)) {
          throw new Error(
            "Execution plan blueprint recommendation policy override family is invalid",
          );
        }
        const recommendationPolicy =
          normalizeExecutionPlanBlueprintRecommendationPolicy(
            request.policyTemplate,
          );
        const entries =
          await this.host.listExecutionPlanBlueprintPortfolioCalibrationEntries();
        const portfolioSetSha256 =
          executionPlanBlueprintPortfolioSetSha256(entries);
        if (
          request.expectedPortfolioSetSha256 !== undefined &&
          request.expectedPortfolioSetSha256 !== portfolioSetSha256
        ) {
          throw new Error(
            "Execution plan blueprint recommendation policy override portfolio set changed",
          );
        }
        const family = createExecutionPlanBlueprintPortfolioCalibrationFamilies(
          entries,
        ).find((candidate) => candidate.familySha256 === request.familySha256);
        if (!family) {
          throw new Error(
            "Execution plan blueprint recommendation policy override family is missing",
          );
        }
        const override = createExecutionPlanBlueprintRecommendationPolicyOverride(
          {
            family,
            recommendationPolicy,
            portfolioSetSha256,
            updatedAt: nowIso(),
          },
        );
        const index =
          this.host.state.executionPlanBlueprintRecommendationPolicyOverrides.findIndex(
            (candidate) => candidate.familySha256 === request.familySha256,
          );
        if (index >= 0) {
          this.host.state.executionPlanBlueprintRecommendationPolicyOverrides[index] =
            override;
        } else {
          this.host.state.executionPlanBlueprintRecommendationPolicyOverrides.push(
            override,
          );
        }
        this.host.state.executionPlanBlueprintRecommendationPolicyOverrides.sort(
          (left, right) => left.familySha256.localeCompare(right.familySha256),
        );
        await this.host.persistState();
        return structuredClone(override);
      });
    }

  async retireExecutionPlanBlueprintRecommendationPolicyOverride(
      request: RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
    ): Promise<RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        if (
          !isSha256(request.familySha256) ||
          !isSha256(request.expectedOverrideSha256) ||
          !isSha256(request.expectedOverrideSetSha256) ||
          !isSha256(request.expectedDriftReviewSetSha256) ||
          !isSha256(request.expectedPortfolioSetSha256)
        ) {
          throw new Error(
            "Execution plan blueprint recommendation policy override retirement request is invalid",
          );
        }
        const entries =
          await this.host.listExecutionPlanBlueprintPortfolioCalibrationEntries();
        const portfolioSetSha256 =
          executionPlanBlueprintPortfolioSetSha256(entries);
        if (request.expectedPortfolioSetSha256 !== portfolioSetSha256) {
          throw new Error(
            "Execution plan blueprint recommendation policy override retirement portfolio set changed",
          );
        }
        const overrides =
          this.host.state.executionPlanBlueprintRecommendationPolicyOverrides.map(
            validateExecutionPlanBlueprintRecommendationPolicyOverride,
          );
        const overrideSetSha256 =
          executionPlanBlueprintRecommendationPolicyOverrideSetSha256(overrides);
        if (request.expectedOverrideSetSha256 !== overrideSetSha256) {
          throw new Error(
            "Execution plan blueprint recommendation policy override retirement override set changed",
          );
        }
        const override = overrides.find(
          (candidate) => candidate.familySha256 === request.familySha256,
        );
        if (!override) {
          throw new Error(
            "Execution plan blueprint recommendation policy override retirement override is missing",
          );
        }
        if (request.expectedOverrideSha256 !== override.contentSha256) {
          throw new Error(
            "Execution plan blueprint recommendation policy override retirement override changed",
          );
        }
        const families =
          createExecutionPlanBlueprintPortfolioCalibrationFamilies(entries);
        const driftReview =
          createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview({
            entries,
            families,
            overrides,
            policies: listExecutionPlanBlueprintRecommendationPolicies(),
            portfolioSetSha256,
          });
        if (
          request.expectedDriftReviewSetSha256 !== driftReview.reviewSetSha256
        ) {
          throw new Error(
            "Execution plan blueprint recommendation policy override retirement drift review changed",
          );
        }
        const review = driftReview.reviews.find(
          (candidate) => candidate.familySha256 === request.familySha256,
        );
        if (!review || review.recommendation !== "retire") {
          throw new Error(
            "Execution plan blueprint recommendation policy override retirement is not retire recommended",
          );
        }
        this.host.state.executionPlanBlueprintRecommendationPolicyOverrides =
          overrides.filter(
            (candidate) => candidate.familySha256 !== request.familySha256,
          );
        const remainingOverrideSetSha256 =
          executionPlanBlueprintRecommendationPolicyOverrideSetSha256(
            this.host.state.executionPlanBlueprintRecommendationPolicyOverrides,
          );
        const result =
          createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult(
            {
              override,
              portfolioSetSha256,
              overrideSetSha256,
              driftReviewSetSha256: driftReview.reviewSetSha256,
              remainingOverrideSetSha256,
              retiredAt: nowIso(),
            },
          );
        this.host.state.executionPlanBlueprintRecommendationPolicyOverrideRetirements.push(
          result,
        );
        await this.host.persistState();
        return structuredClone(result);
      });
    }

  async listExecutionPlanBlueprintPortfolioCalibrationEntries(): Promise<
      ExecutionPlanBlueprintPortfolioCalibrationEntry[]
    > {
      const records = [...this.host.state.executionPlanBlueprints].sort(
        compareExecutionPlanBlueprintRecords,
      );
      const entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[] = [];
      for (const record of records) {
        const sourceQualification =
          await this.host.qualifyExecutionPlanBlueprintRecord(record.id);
        const outcomeQualification =
          await this.host.qualifyExecutionPlanBlueprintRecordOutcomes(record.id);
        const latestBaseline = this.host.state.executionPlanBlueprintOutcomeBaselines
          .filter((baseline) => baseline.recordId === record.id)
          .sort((left, right) => left.promotedAt.localeCompare(right.promotedAt))
          .at(-1);
        entries.push(
          createExecutionPlanBlueprintPortfolioCalibrationEntry({
            record,
            sourceQualification,
            outcomeQualification,
            ...(latestBaseline ? { latestBaseline } : {}),
          }),
        );
      }
      return entries;
    }
}
