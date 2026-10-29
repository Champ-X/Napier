import type { Usage } from "@napier/contracts";
import type { ModelAccountingPhase } from "@napier/contracts/model-accounting";
import type { ModelInvocationAccounting, ModelCallAccountingRepositoryPort } from "./model-call-accounting-driver.js";
import type { ModelUsagePreparationAuthority } from "./model-call-attribution.js";
import { createId } from "./ids.js";
export interface RunAccountingBudgetSnapshot {
  accountingRevision: number;
  knownBudgetCostUsd?: number;
  usage: Usage;
  summary: { budgetTokens: number; budgetCostUsd: number | null };
}

interface ModelAccountingRegistryRepository extends ModelCallAccountingRepositoryPort {
  runAuthority(input: { runId: string; token: string }): ModelUsagePreparationAuthority;
  operationAuthority(input: { operationId: string; operation: ModelAccountingPhase }): ModelUsagePreparationAuthority;
  readRunAccounting(runId: string): Promise<RunAccountingBudgetSnapshot>;
}

/** Registry-local capabilities never flow into provider request data. */
export class ModelAccountingRegistry {
  private readonly runAccountingAuthorities = new Map<string, ModelUsagePreparationAuthority>();
  constructor(readonly accountingRepository?: ModelAccountingRegistryRepository) {}

  bindRunAccounting(runId: string, token: string, budget?: import("./run-budget.js").RunBudgetTracker): void {
    const repository = this.accountingRepository;
    if (!repository) return;
    this.runAccountingAuthorities.set(runId, repository.runAuthority({ runId, token }));
    budget?.bindAccounting(() => repository.readRunAccounting(runId));
  }

  releaseRunAccounting(runId: string): void { this.runAccountingAuthorities.delete(runId); }

  accountingForRun(runId: string, logicalCallId = createId("modelcall")): ModelInvocationAccounting | undefined {
    if (!this.accountingRepository) return undefined;
    const owner = this.runAccountingAuthorities.get(runId);
    if (!owner) throw new Error("Model Run invocation has no native accounting owner");
    return { repository: this.accountingRepository, owner, logicalCallId };
  }

  accountingForOperation(phase: ModelAccountingPhase): ModelInvocationAccounting | undefined {
    if (!this.accountingRepository) return undefined;
    const operationId = createId("modeloperation");
    return { repository: this.accountingRepository,
      owner: this.accountingRepository.operationAuthority({ operationId, operation: phase }), logicalCallId: operationId };
  }

}
