import { describe, expect, it, vi } from "vitest";

import {
  PlanBlueprintLibraryCard,
  type PlanBlueprintLibraryCardActions,
  type PlanBlueprintLibraryCardState,
} from "../src/PlanBlueprintLibraryCard";
import { planCopy } from "../src/plan-copy";
import { renderToStaticMarkup } from "./render-static-preact";

describe("Plan blueprint library components", () => {
  it("renders empty, unsigned, and model-unavailable states without overlap", () => {
    const markup = renderToStaticMarkup(
      <PlanBlueprintLibraryCard state={state()} actions={actions()} />,
    );

    expect(markup).toContain(planCopy.blueprint.library.title);
    expect(markup).toContain(planCopy.blueprint.library.noVerified);
    expect(markup).toContain(planCopy.blueprint.library.empty);
    expect(markup).toContain(planCopy.modelUnavailableHint);
    expect(markup).toContain("0");
  });

  it("keeps all portable verification inputs paired with accessible labels", () => {
    const markup = renderToStaticMarkup(
      <PlanBlueprintLibraryCard
        state={state({
          busyAction: "verifyHistory",
          selectedModelConfigured: true,
        })}
        actions={actions()}
      />,
    );

    expect(markup.match(/type="file"/gu)).toHaveLength(5);
    expect(markup).toContain(planCopy.blueprint.library.verifyingHistory);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain(planCopy.modelUnavailableHint);
  });
});

function state(
  overrides: Partial<PlanBlueprintLibraryCardState> = {},
): PlanBlueprintLibraryCardState {
  return {
    records: [],
    loaded: true,
    hasVerifiedBlueprint: false,
    canSave: false,
    canSelect: false,
    canSignPolicyOverrideRetirementProofBundle: false,
    canCreateRecord: false,
    busyAction: undefined,
    receipt: undefined,
    latestOutcomeReview: undefined,
    error: undefined,
    selectedModelConfigured: false,
    ...overrides,
  };
}

function actions(): PlanBlueprintLibraryCardActions {
  return {
    onRefresh: vi.fn(),
    onSave: vi.fn(),
    onSelect: vi.fn(),
    onCalibrate: vi.fn(),
    onBacktestPolicy: vi.fn(),
    onApplyPolicyOverride: vi.fn(),
    onReviewPolicyOverrideDrift: vi.fn(),
    onRetirePolicyOverride: vi.fn(),
    onAuditPolicyOverrideRetirements: vi.fn(),
    onVerifyPolicyOverrideRetirements: vi.fn(),
    onVerifyPolicyOverrideRetirementProofBundle: vi.fn(),
    onSignPolicyOverrideRetirementProofBundle: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onQualify: vi.fn(),
    onPreview: vi.fn(),
    onHistory: vi.fn(),
    onVerifyHistory: vi.fn(),
    onOutcomes: vi.fn(),
    onVerifyOutcomes: vi.fn(),
    onPromoteOutcomeBaseline: vi.fn(),
    onPromoteReviewedOutcomeBaseline: vi.fn(),
    onQualifyOutcomes: vi.fn(),
    onReviewOutcomes: vi.fn(),
    onCreate: vi.fn(),
  };
}
