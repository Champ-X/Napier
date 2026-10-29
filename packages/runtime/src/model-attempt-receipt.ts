import type { RunRecord } from "@napier/contracts";
import type { ModelCallAttributionV1, ModelPhysicalObservationV1 } from "@napier/contracts/model-accounting";
import { canonicalJson } from "./ed25519.js";
import { readModelUsagePreparationAuthority, type ModelUsagePreparationAuthority } from "./model-call-attribution.js";
import { validateModelCallAttribution, validateModelPhysicalObservation } from "./model-usage-observation.js";
import type { LedgerModelAccountingPort, LedgerModelAttemptView } from "./sqlite-model-accounting.js";

export type ModelAttemptReceiptState = "pending" | "known" | "incomplete" | "undispatched";
export interface ModelAttemptReceiptInput {
  owner: ModelUsagePreparationAuthority;
  physicalId: string;
  attributionSha256: string;
}
export interface ModelAttemptReceiptView {
  state: ModelAttemptReceiptState;
  physicalId: string;
  attributionSha256: string;
  workspaceRevision: number;
  accountingRevision: number;
  receiptSha256?: string;
  usageStatus?: ModelPhysicalObservationV1["usageStatus"];
}
interface AttemptScope { sourceId: string; hostWorkspaceId?: string; dataRootSha256: string; workspaceRootSha256: string }

/** Exact durable evidence only: this does not attest source ACK or authorize another call. */
export function readModelAttemptReceipt(input: ModelAttemptReceiptInput, repository: object,
  ledger: LedgerModelAccountingPort, scope: AttemptScope): ModelAttemptReceiptView {
  const { owner: authorityOwner } = readModelUsagePreparationAuthority(input.owner, repository);
  // An old attempt remains readable after its logical settlement advances the
  // execution revision. Fresh invocation admission owns all live lease checks.
  const { token: _token, expectedExecutionRevision: _revision, ...owner } = authorityOwner as
    typeof authorityOwner & { token?: string; expectedExecutionRevision?: number };
  const view = ledger.readModelAttemptView(input.physicalId);
  const attribution = assertNativeAttempt(view, input, owner, scope), native = view.attribution!;
  if (!view.snapshot) fail("workspace projection is unavailable");
  const state = JSON.parse(view.snapshot.stateJson) as { runs: RunRecord[] };
  const run = native.runId === null ? undefined : state.runs.find((run) => run.id === native.runId);
  if (attribution.owner.kind !== "operation" && (!run || !run.accounting || run.threadId !== attribution.owner.threadId))
    fail("projected Run is unavailable");
  const base = { physicalId: input.physicalId, attributionSha256: input.attributionSha256,
    workspaceRevision: view.snapshot.revision, accountingRevision: run?.accounting?.revision ?? 0 };
  if (!view.claim) {
    if (native.state === "settled") fail("settled attribution lacks its immutable claim");
    return { ...base, state: "pending" };
  }
  const observation = assertAttemptClaim(view, attribution);
  return { ...base, state: observation.usageStatus === "known" ? "known" :
    observation.usageStatus === "known_zero_undispatched" ? "undispatched" : "incomplete",
    receiptSha256: observation.contentSha256, usageStatus: observation.usageStatus };
}

function assertNativeAttempt(view: LedgerModelAttemptView, input: ModelAttemptReceiptInput,
  owner: object, scope: AttemptScope): ModelCallAttributionV1 {
  const native = view.attribution;
  if (!native) fail("native attribution is unavailable");
  const attribution = validateModelCallAttribution(JSON.parse(native.attributionJson));
  if (attribution.physicalId !== input.physicalId || attribution.contentSha256 !== input.attributionSha256 ||
      native.physicalId !== input.physicalId || native.attributionSha256 !== input.attributionSha256 ||
      native.attributionJson !== canonicalJson(attribution) || canonicalJson(owner) !== canonicalJson(attribution.owner) ||
      attribution.workspaceLedgerId !== view.workspaceLedgerId || attribution.receiptSourceId !== scope.sourceId ||
      attribution.hostWorkspaceId !== scope.hostWorkspaceId || native.dataRootSha256 !== scope.dataRootSha256 ||
      native.workspaceRootSha256 !== scope.workspaceRootSha256 ||
      native.runId !== (attribution.owner.kind === "operation" ? null : attribution.owner.runId) ||
      native.childInvocationId !== (attribution.owner.kind === "child" ? attribution.owner.childInvocationId : null))
    fail("native owner, source or attribution binding differs");
  return attribution;
}

function assertAttemptClaim(view: LedgerModelAttemptView, attribution: ModelCallAttributionV1): ModelPhysicalObservationV1 {
  const native = view.attribution!, claim = view.claim!;
  const observation = validateModelPhysicalObservation(JSON.parse(claim.receiptJson), attribution);
  if (native.state !== "settled" || claim.physicalId !== attribution.physicalId ||
      claim.attributionSha256 !== attribution.contentSha256 || claim.receiptSha256 !== observation.contentSha256 ||
      claim.receiptJson !== canonicalJson(observation)) fail("immutable claim binding differs");
  if (attribution.owner.kind === "operation") {
    if (claim.eventId !== null || view.event !== undefined) fail("operation claim has Run evidence");
  } else if (!view.event || view.event.id !== claim.eventId || view.event.runId !== attribution.owner.runId ||
      view.event.threadId !== attribution.owner.threadId || view.event.type !== "model.usage.reconciled" ||
      canonicalJson(view.event.payload) !== canonicalJson({ physicalId: attribution.physicalId,
        attributionSha256: attribution.contentSha256, accountingMode: "physical_receipt_v1", observation })) {
    fail("claim differs from its committed projection event");
  }
  return observation;
}

function fail(reason: string): never { throw new Error(`Model attempt receipt ${reason}`); }
