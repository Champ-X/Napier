import { createHash } from "node:crypto";
import type { ExecutionPlan } from "@napier/contracts";
import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  checkPlanArtifactDrift,
  type PlanArtifactDriftCheckReceipt,
} from "../src/artifact-file-api";
import {
  usePlanArtifactController,
  type PlanArtifactController,
} from "../src/use-plan-artifact-controller";

vi.mock("../src/artifact-file-api", async (original) => ({
  ...(await original<typeof import("../src/artifact-file-api")>()),
  checkPlanArtifactDrift: vi.fn(),
}));
let container: HTMLElement;
let controller: PlanArtifactController;
afterEach(async () => {
  if (container) await act(async () => render(null, container));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("does not display a late drift result after the selected plan revision changes", async () => {
  let finish!: (value: PlanArtifactDriftCheckReceipt) => void;
  vi.mocked(checkPlanArtifactDrift).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onChanged = vi.fn();
  await show(plan(1), onChanged);
  await act(async () => {
    controller.actions.onCheckDrift(plan(1).artifacts[0]!);
  });
  expect(controller.state.busyId).toBe("report:drift-check");
  await show(plan(2), onChanged);
  await act(async () => finish(receipt(1)));
  expect(controller.state.driftCheck).toBeUndefined();
  expect(controller.state.busyId).toBeUndefined();
  expect(onChanged).not.toHaveBeenCalled();
});

it("rejects a newer drift receipt even before the parent refresh supplies its manifest", async () => {
  vi.mocked(checkPlanArtifactDrift).mockResolvedValue(receipt(2));
  await show(plan(1), vi.fn());
  await act(async () => {
    await controller.actions.onCheckDrift(plan(1).artifacts[0]!);
  });
  expect(controller.state.driftCheck).toBeUndefined();
  expect(controller.state.error).toContain("different artifact version");
});

async function show(selected: ExecutionPlan, onChanged: () => void) {
  if (
    typeof document === "undefined" ||
    !container ||
    !document.body.contains(container)
  ) {
    const parsed = parseHTML('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal("document", parsed.document);
    vi.stubGlobal("window", parsed.window);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = parsed.document.querySelector("#root") as HTMLElement;
  }
  await act(async () =>
    render(<Harness plan={selected} onChanged={onChanged} />, container),
  );
}
function Harness({
  plan: selected,
  onChanged,
}: {
  plan: ExecutionPlan;
  onChanged(): void;
}) {
  controller = usePlanArtifactController({
    threadId: "thread_1",
    plan: selected,
    resetKey: undefined,
    onChanged,
  });
  return null;
}
function plan(revision: number): ExecutionPlan {
  return {
    id: "plan_1",
    threadId: "thread_1",
    revision,
    artifacts: [
      {
        id: "report",
        path: "report.md",
        kind: "file",
        status: "verified",
        sha256: "a".repeat(64),
        sizeBytes: 16,
        description: "Report",
        evidence: "Recorded",
        createdAt: "2026-10-30T00:00:00Z",
        updatedAt: "2026-10-30T00:00:00Z",
      },
    ],
  } as ExecutionPlan;
}
function receipt(planRevision: number): PlanArtifactDriftCheckReceipt {
  return {
    kind: "napier.plan-artifact-drift-check",
    schemaVersion: 1,
    planId: "plan_1",
    artifactId: "report",
    planRevision,
    status: "verified",
    artifactKind: "file",
    pathSha256: createHash("sha256").update("report.md").digest("hex"),
    expectedSha256: "a".repeat(64),
    result: "drifted",
    observedSha256: "b".repeat(64),
    sizeBytes: 20,
    ledgerEventId: "event_1",
    ledgerEventSeq: 1,
    ledgerEventSha256: "c".repeat(64),
  };
}
