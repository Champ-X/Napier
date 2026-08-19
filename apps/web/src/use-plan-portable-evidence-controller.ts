import { useEffect, useState } from "react";

import type {
  ExecutionPlan,
  ExecutionPlanArchive,
  ExecutionPlanBlueprint,
} from "@napier/contracts";

import {
  createExecutionPlanFromBlueprint,
  getExecutionPlanArchive,
  getExecutionPlanBlueprint,
  verifyExecutionPlanArchive,
  verifyExecutionPlanBlueprint,
} from "./api";
import { formatApiErrorMessage } from "./api-error";
import {
  executionPlanArchiveFilename,
  executionPlanBlueprintFilename,
} from "./plan-archive-artifact-view-model";
import {
  downloadPlanJson,
  MAX_PLAN_ARCHIVE_FILE_BYTES,
  MAX_PLAN_BLUEPRINT_FILE_BYTES,
} from "./plan-panel-helpers";
import { planCopy } from "./plan-copy";
import type {
  PlanArchiveReceipt,
  PlanBlueprintReceipt,
} from "./PlanPortableEvidenceCards";

export interface PlanArchiveController {
  receipt: PlanArchiveReceipt | undefined;
  busyAction: "export" | "verify" | undefined;
  error: string | undefined;
  onExport: () => Promise<void>;
  onVerify: (file: File) => Promise<void>;
}

export interface PlanBlueprintController {
  receipt: PlanBlueprintReceipt | undefined;
  busyAction: "export" | "verify" | "create" | undefined;
  error: string | undefined;
  verifiedBlueprint: ExecutionPlanBlueprint | undefined;
  onExport: () => Promise<void>;
  onVerify: (file: File) => Promise<void>;
  onCreate: () => Promise<void>;
}

export interface UsePlanPortableEvidenceControllerOptions {
  threadId: string | undefined;
  plan: ExecutionPlan | undefined;
  hasOpenPlan: boolean;
  resetKey: string | undefined;
  onChanged: () => void | Promise<void>;
}

export function usePlanPortableEvidenceController({
  threadId,
  plan,
  hasOpenPlan,
  resetKey,
  onChanged,
}: UsePlanPortableEvidenceControllerOptions): {
  archive: PlanArchiveController;
  blueprint: PlanBlueprintController;
} {
  const [archiveBusyAction, setArchiveBusyAction] = useState<
    "export" | "verify"
  >();
  const [archiveReceipt, setArchiveReceipt] = useState<PlanArchiveReceipt>();
  const [archiveError, setArchiveError] = useState<string>();
  const [blueprintBusyAction, setBlueprintBusyAction] = useState<
    "export" | "verify" | "create"
  >();
  const [blueprintReceipt, setBlueprintReceipt] =
    useState<PlanBlueprintReceipt>();
  const [blueprintError, setBlueprintError] = useState<string>();
  const [verifiedBlueprint, setVerifiedBlueprint] =
    useState<ExecutionPlanBlueprint>();

  useEffect(() => {
    setArchiveReceipt(undefined);
    setArchiveError(undefined);
    setBlueprintReceipt(undefined);
    setBlueprintError(undefined);
    setVerifiedBlueprint(undefined);
  }, [resetKey]);

  const exportArchive = async (): Promise<void> => {
    if (!plan || archiveBusyAction) return;
    setArchiveBusyAction("export");
    setArchiveReceipt(undefined);
    setArchiveError(undefined);
    try {
      const archive = await getExecutionPlanArchive(plan.threadId, plan.id);
      downloadPlanJson(archive, executionPlanArchiveFilename(archive));
      setArchiveReceipt({
        action: "exported",
        contentSha256: archive.contentSha256,
        eventStreamSha256: archive.eventStreamSha256,
        revision: archive.plan.revision,
        eventCount: archive.events.length,
        stepCount: archive.plan.steps.length,
        artifactCount: archive.plan.artifacts.length,
        replanCount: archive.plan.replans.length,
      });
    } catch (error) {
      setArchiveError(formatApiErrorMessage(error));
    } finally {
      setArchiveBusyAction(undefined);
    }
  };

  const verifyArchive = async (file: File): Promise<void> => {
    if (!plan) return;
    if (file.size > MAX_PLAN_ARCHIVE_FILE_BYTES) {
      setArchiveError(planCopy.archive.errors.tooLarge);
      return;
    }
    setArchiveBusyAction("verify");
    setArchiveReceipt(undefined);
    setArchiveError(undefined);
    try {
      const archive = JSON.parse(await file.text()) as ExecutionPlanArchive;
      const result = await verifyExecutionPlanArchive(plan.threadId, plan.id, {
        archive,
      });
      setArchiveReceipt({
        action: "verified",
        status: result.status,
        diagnostics: result.diagnostics,
        ...(result.contentSha256
          ? { contentSha256: result.contentSha256 }
          : {}),
        ...(result.eventStreamSha256
          ? { eventStreamSha256: result.eventStreamSha256 }
          : {}),
        ...(result.revision !== undefined ? { revision: result.revision } : {}),
        eventCount: result.eventCount,
        stepCount: result.stepCount,
        artifactCount: result.artifactCount,
        replanCount: result.replanCount,
      });
    } catch (error) {
      setArchiveError(
        error instanceof SyntaxError
          ? planCopy.archive.errors.invalid
          : formatApiErrorMessage(error),
      );
    } finally {
      setArchiveBusyAction(undefined);
    }
  };

  const exportBlueprint = async (): Promise<void> => {
    if (!plan || blueprintBusyAction) return;
    setBlueprintBusyAction("export");
    setBlueprintReceipt(undefined);
    setBlueprintError(undefined);
    setVerifiedBlueprint(undefined);
    try {
      const blueprint = await getExecutionPlanBlueprint(plan.threadId, plan.id);
      downloadPlanJson(blueprint, executionPlanBlueprintFilename(blueprint));
      setBlueprintReceipt({
        action: "exported",
        contentSha256: blueprint.contentSha256,
        sourcePlanRevision: blueprint.source.planRevision,
        stepCount: blueprint.stepCount,
        artifactCount: blueprint.artifactCount,
      });
      setVerifiedBlueprint(blueprint);
    } catch (error) {
      setBlueprintError(formatApiErrorMessage(error));
    } finally {
      setBlueprintBusyAction(undefined);
    }
  };

  const verifyBlueprint = async (file: File): Promise<void> => {
    if (!threadId) return;
    if (file.size > MAX_PLAN_BLUEPRINT_FILE_BYTES) {
      setBlueprintError(planCopy.blueprint.errors.tooLarge);
      return;
    }
    setBlueprintBusyAction("verify");
    setBlueprintReceipt(undefined);
    setBlueprintError(undefined);
    setVerifiedBlueprint(undefined);
    try {
      const blueprint = JSON.parse(await file.text()) as ExecutionPlanBlueprint;
      const result = await verifyExecutionPlanBlueprint(threadId, {
        blueprint,
      });
      setBlueprintReceipt({
        action: "verified",
        status: result.status,
        diagnostics: result.diagnostics,
        ...(result.contentSha256
          ? { contentSha256: result.contentSha256 }
          : {}),
        ...(result.sourcePlanRevision !== undefined
          ? { sourcePlanRevision: result.sourcePlanRevision }
          : {}),
        stepCount: result.stepCount,
        artifactCount: result.artifactCount,
      });
      if (result.status === "valid") setVerifiedBlueprint(blueprint);
    } catch (error) {
      setBlueprintError(
        error instanceof SyntaxError
          ? planCopy.blueprint.errors.invalid
          : formatApiErrorMessage(error),
      );
    } finally {
      setBlueprintBusyAction(undefined);
    }
  };

  const createFromBlueprint = async (): Promise<void> => {
    if (!threadId || !verifiedBlueprint || blueprintBusyAction || hasOpenPlan) {
      return;
    }
    setBlueprintBusyAction("create");
    setBlueprintError(undefined);
    try {
      const created = await createExecutionPlanFromBlueprint(threadId, {
        blueprint: verifiedBlueprint,
      });
      setBlueprintReceipt({
        action: "created",
        contentSha256: verifiedBlueprint.contentSha256,
        planId: created.id,
        stepCount: created.steps.length,
        artifactCount: created.artifacts.length,
      });
      setVerifiedBlueprint(undefined);
      await onChanged();
    } catch (error) {
      setBlueprintError(formatApiErrorMessage(error));
    } finally {
      setBlueprintBusyAction(undefined);
    }
  };

  return {
    archive: {
      receipt: archiveReceipt,
      busyAction: archiveBusyAction,
      error: archiveError,
      onExport: exportArchive,
      onVerify: verifyArchive,
    },
    blueprint: {
      receipt: blueprintReceipt,
      busyAction: blueprintBusyAction,
      error: blueprintError,
      verifiedBlueprint,
      onExport: exportBlueprint,
      onVerify: verifyBlueprint,
      onCreate: createFromBlueprint,
    },
  };
}
