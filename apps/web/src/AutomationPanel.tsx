import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Download,
  Inbox,
  KeyRound,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Webhook,
} from "lucide-react";

import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  AutomationSchedule,
  BootstrapResponse,
  CreatedInboundChannel,
  InboundChannel,
  InboundChannelAdapter,
  InboundChannelAdapterDescriptor,
  InboundChannelAdapterPreview,
  InboundChannelPolicyTemplateId,
  InboundDeadLetterExport,
  InboundDeadLetterExportVerification,
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
  InboundDeadLetterRetryPreview,
  InboundDelivery,
  InboundDeliveryQualification,
  InboundRetryPolicy,
  PreviewInboundChannelAdapterRequest,
  UpdateInboundSignaturePolicyRequest,
} from "@napier/contracts";

import {
  applyInboundDeadLetterRetry,
  createInboundChannel,
  createSchedule,
  exportInboundDeadLetters,
  getAutomationBootstrap,
  getInboundDeadLetterRetryHistory,
  getInboundDeliveries,
  getInboundDeliveryQualification,
  previewInboundDeadLetterRetry,
  previewInboundChannelAdapter,
  retryInboundDelivery,
  rotateInboundChannelToken,
  setInboundChannelStatus,
  updateInboundRetryPolicy,
  updateInboundSignaturePolicy,
  updateSchedule,
  verifyInboundDeadLetterExport,
  verifyInboundDeadLetterRetryHistory,
} from "./automation-api";
import { automationCopy as copy } from "./automation-copy";
import { formatApiErrorMessage } from "./api-error";

const CHANNEL_POLICY_TEMPLATES: Readonly<
  Record<
    Exclude<InboundChannelPolicyTemplateId, "custom">,
    { maxAttempts: number; retrySeconds: number; signatureRequired: boolean }
  >
> = {
  legacy_bearer: {
    maxAttempts: 3,
    retrySeconds: 5,
    signatureRequired: false,
  },
  signed_standard: {
    maxAttempts: 3,
    retrySeconds: 5,
    signatureRequired: true,
  },
  signed_strict: {
    maxAttempts: 2,
    retrySeconds: 1,
    signatureRequired: true,
  },
};
const CHANNEL_POLICY_TEMPLATE_IDS: InboundChannelPolicyTemplateId[] = [
  "signed_standard",
  "signed_strict",
  "legacy_bearer",
  "custom",
];
const MAX_DEAD_LETTER_EXPORT_FILE_BYTES = 2 * 1024 * 1024;
export interface AutomationPanelProps {
  threadId: string;
  schedules: AutomationSchedule[];
  channels: InboundChannel[];
  inboundChannelAdapters: InboundChannelAdapterDescriptor[];
  recoveryAssessments: AutomaticRecoveryAssessment[];
  recoveryAttempts: AutomaticRecoveryAttempt[];
  recoveryPending: boolean;
  onBootstrapUpdated: (bootstrap: BootstrapResponse) => void;
}

export default function AutomationPanel({
  threadId,
  schedules,
  channels,
  inboundChannelAdapters,
  recoveryAssessments,
  recoveryAttempts,
  recoveryPending,
  onBootstrapUpdated,
}: AutomationPanelProps) {
  const threadSchedules = schedules.filter(
    (schedule) => schedule.threadId === threadId,
  );
  const threadChannels = channels.filter(
    (channel) => channel.threadId === threadId,
  );
  const adapterById = useMemo(
    () =>
      new Map(
        inboundChannelAdapters.map((adapter) => [adapter.id, adapter] as const),
      ),
    [inboundChannelAdapters],
  );
  const [scheduleName, setScheduleName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [triggerType, setTriggerType] = useState<"interval" | "cron">(
    "interval",
  );
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [cronExpression, setCronExpression] = useState("0 9 * * 1-5");
  const [channelName, setChannelName] = useState("");
  const [channelAdapter, setChannelAdapter] =
    useState<InboundChannelAdapter>("napier_json");
  const [channelPolicyTemplate, setChannelPolicyTemplate] =
    useState<InboundChannelPolicyTemplateId>("signed_standard");
  const [channelMaxAttempts, setChannelMaxAttempts] = useState(3);
  const [channelRetrySeconds, setChannelRetrySeconds] = useState(5);
  const [channelSignatureRequired, setChannelSignatureRequired] =
    useState(true);
  const [createdChannel, setCreatedChannel] = useState<CreatedInboundChannel>();
  const [deliveries, setDeliveries] = useState<
    Record<string, InboundDelivery[]>
  >({});
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [tokenCopied, setTokenCopied] = useState(false);
  const [rotateConfirmId, setRotateConfirmId] = useState<string>();
  const [retryConfirmId, setRetryConfirmId] = useState<string>();
  const [deadLetterExports, setDeadLetterExports] = useState<
    Record<
      string,
      {
        deliveryCount: number;
        contentSha256: string;
        qualifiedCount: number;
        evidenceMissingCount: number;
        adapterCatalogDriftCount: number;
      }
    >
  >({});
  const [deadLetterVerifications, setDeadLetterVerifications] = useState<
    Record<string, InboundDeadLetterExportVerification>
  >({});
  const [deadLetterRetryArtifacts, setDeadLetterRetryArtifacts] = useState<
    Record<string, unknown>
  >({});
  const [deadLetterRetryPreviews, setDeadLetterRetryPreviews] = useState<
    Record<string, InboundDeadLetterRetryPreview>
  >({});
  const [deadLetterRetryResults, setDeadLetterRetryResults] = useState<
    Record<string, InboundDeadLetterRetryApplyResult>
  >({});
  const [deadLetterRetryHistories, setDeadLetterRetryHistories] = useState<
    Record<string, InboundDeadLetterRetryHistory>
  >({});
  const [
    deadLetterRetryHistoryVerifications,
    setDeadLetterRetryHistoryVerifications,
  ] = useState<Record<string, InboundDeadLetterRetryHistoryVerification>>({});
  const [deadLetterRetryConfirmId, setDeadLetterRetryConfirmId] =
    useState<string>();
  const [deliveryQualifications, setDeliveryQualifications] = useState<
    Record<string, InboundDeliveryQualification>
  >({});
  const [adapterPreviews, setAdapterPreviews] = useState<
    Record<string, InboundChannelAdapterPreview>
  >({});

  const canCreateSchedule =
    scheduleName.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (triggerType === "interval"
      ? Number.isInteger(intervalMinutes) && intervalMinutes >= 1
      : cronExpression.trim().length > 0);
  const canCreateChannel =
    channelName.trim().length > 0 &&
    Number.isInteger(channelMaxAttempts) &&
    channelMaxAttempts >= 1 &&
    channelMaxAttempts <= 10 &&
    Number.isFinite(channelRetrySeconds) &&
    channelRetrySeconds >= 0.25 &&
    channelRetrySeconds <= 60;
  const endpoint = useMemo(
    () =>
      createdChannel
        ? `${window.location.origin}/api/channels/${createdChannel.channel.id}/inbound`
        : "",
    [createdChannel],
  );
  const activeDeliveryChannelKey = useMemo(
    () =>
      Object.entries(deliveries)
        .filter(([, items]) =>
          items.some(
            (delivery) =>
              delivery.status === "accepted" ||
              delivery.status === "running" ||
              delivery.status === "retrying",
          ),
        )
        .map(([channelId]) => channelId)
        .sort()
        .join(","),
    [deliveries],
  );
  const threadChannelHistoryKey = threadChannels
    .map((channel) => channel.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!activeDeliveryChannelKey) return;
    const channelIds = activeDeliveryChannelKey.split(",");
    let cancelled = false;
    const refreshActiveDeliveries = async (): Promise<void> => {
      try {
        const results = await Promise.all(
          channelIds.map(async (channelId) => ({
            channelId,
            deliveries: await getInboundDeliveries(channelId),
          })),
        );
        if (cancelled) return;
        setDeliveries((current) => {
          const updated = { ...current };
          for (const result of results) {
            updated[result.channelId] = result.deliveries;
          }
          return updated;
        });
      } catch {
        // The next interval or an explicit refresh can recover transient reads.
      }
    };
    const timer = window.setInterval(
      () => void refreshActiveDeliveries(),
      2_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeDeliveryChannelKey]);

  useEffect(() => {
    if (!threadChannelHistoryKey) return;
    const channelIds = threadChannelHistoryKey.split(",");
    let cancelled = false;
    void Promise.all(
      channelIds.map(async (channelId) => ({
        channelId,
        history: await getInboundDeadLetterRetryHistory(channelId),
      })),
    )
      .then((results) => {
        if (cancelled) return;
        setDeadLetterRetryHistories((current) => {
          const updated = { ...current };
          for (const result of results) {
            updated[result.channelId] = result.history;
          }
          return updated;
        });
      })
      .catch(() => {
        // The next bootstrap refresh or retry apply action can recover history.
      });
    return () => {
      cancelled = true;
    };
  }, [threadChannelHistoryKey]);

  const refresh = async (): Promise<void> => {
    onBootstrapUpdated(await getAutomationBootstrap(threadId));
  };

  useEffect(() => {
    const active = recoveryAttempts.some(
      (attempt) => attempt.status === "claimed" || attempt.status === "running",
    );
    if (!recoveryPending && !active) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [recoveryAttempts, recoveryPending, threadId]);

  const addSchedule = async (): Promise<void> => {
    if (!canCreateSchedule || busyId) return;
    setBusyId("new-schedule");
    setError(undefined);
    try {
      await createSchedule({
        name: scheduleName.trim(),
        threadId,
        prompt: prompt.trim(),
        trigger:
          triggerType === "interval"
            ? {
                type: "interval",
                everyMs: intervalMinutes * 60_000,
              }
            : {
                type: "cron",
                expression: cronExpression.trim(),
                timezone: "UTC",
              },
      });
      setScheduleName("");
      setPrompt("");
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const toggleSchedule = async (
    schedule: AutomationSchedule,
  ): Promise<void> => {
    setBusyId(schedule.id);
    setError(undefined);
    try {
      await updateSchedule(schedule.id, {
        status: schedule.status === "active" ? "paused" : "active",
      });
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const addChannel = async (): Promise<void> => {
    if (!canCreateChannel || busyId) return;
    setBusyId("new-channel");
    setError(undefined);
    setTokenCopied(false);
    try {
      const created = await createInboundChannel({
        name: channelName.trim(),
        threadId,
        adapter: channelAdapter,
        ...(channelPolicyTemplate === "custom"
          ? {
              policyTemplate: "custom" as const,
              retryPolicy: {
                maxAttempts: channelMaxAttempts,
                baseDelayMs: Math.round(channelRetrySeconds * 1_000),
              },
              signaturePolicy: {
                required: channelSignatureRequired,
                toleranceSeconds: 300,
              },
            }
          : { policyTemplate: channelPolicyTemplate }),
      });
      setCreatedChannel(created);
      setChannelName("");
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const selectChannelPolicyTemplate = (
    templateId: InboundChannelPolicyTemplateId,
  ): void => {
    setChannelPolicyTemplate(templateId);
    if (templateId === "custom") return;
    const template = CHANNEL_POLICY_TEMPLATES[templateId];
    setChannelMaxAttempts(template.maxAttempts);
    setChannelRetrySeconds(template.retrySeconds);
    setChannelSignatureRequired(template.signatureRequired);
  };

  const toggleChannel = async (channel: InboundChannel): Promise<void> => {
    setBusyId(channel.id);
    setError(undefined);
    try {
      await setInboundChannelStatus(channel.id, {
        status: channel.status === "active" ? "disabled" : "active",
      });
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const rotateChannelToken = async (channel: InboundChannel): Promise<void> => {
    const operationId = `rotate:${channel.id}`;
    setBusyId(operationId);
    setError(undefined);
    setTokenCopied(false);
    try {
      const rotated = await rotateInboundChannelToken(channel.id);
      setCreatedChannel(rotated);
      setRotateConfirmId(undefined);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const loadDeliveries = async (channelId: string): Promise<void> => {
    setBusyId(`deliveries:${channelId}`);
    setError(undefined);
    try {
      const result = await getInboundDeliveries(channelId);
      setDeliveries((current) => ({ ...current, [channelId]: result }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const previewChannelAdapter = async (
    channelId: string,
    body: string,
    headersText: string,
  ): Promise<boolean> => {
    const operationId = `preview:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      const request: PreviewInboundChannelAdapterRequest = {
        body,
        ...parsePreviewHeaders(headersText),
      };
      const preview = await previewInboundChannelAdapter(channelId, request);
      setAdapterPreviews((current) => ({
        ...current,
        [channelId]: preview,
      }));
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusyId(undefined);
    }
  };

  const retryDelivery = async (
    channelId: string,
    deliveryId: string,
  ): Promise<void> => {
    const operationId = `retry:${deliveryId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      await retryInboundDelivery(channelId, deliveryId);
      setRetryConfirmId(undefined);
      const result = await getInboundDeliveries(channelId);
      setDeliveries((current) => ({ ...current, [channelId]: result }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const qualifyDelivery = async (
    channelId: string,
    deliveryId: string,
  ): Promise<void> => {
    const operationId = `qualify:${deliveryId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      const result = await getInboundDeliveryQualification(
        channelId,
        deliveryId,
      );
      setDeliveryQualifications((current) => ({
        ...current,
        [deliveryId]: result,
      }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const saveChannelRetryPolicy = async (
    channelId: string,
    retryPolicy: InboundRetryPolicy,
  ): Promise<boolean> => {
    const operationId = `policy:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      await updateInboundRetryPolicy(channelId, { retryPolicy });
      await refresh();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusyId(undefined);
    }
  };

  const saveChannelSignaturePolicy = async (
    channelId: string,
    signaturePolicy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ): Promise<boolean> => {
    const operationId = `signature-policy:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      await updateInboundSignaturePolicy(channelId, { signaturePolicy });
      await refresh();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusyId(undefined);
    }
  };

  const inspectDeadLetterArtifact = async (
    channelId: string,
    artifact: unknown,
  ): Promise<void> => {
    const [verification, retryPreview] = await Promise.all([
      verifyInboundDeadLetterExport(channelId, { artifact }),
      previewInboundDeadLetterRetry(channelId, { artifact }),
    ]);
    setDeadLetterRetryArtifacts((current) => ({
      ...current,
      [channelId]: artifact,
    }));
    setDeadLetterVerifications((current) => ({
      ...current,
      [channelId]: verification,
    }));
    setDeadLetterRetryPreviews((current) => ({
      ...current,
      [channelId]: retryPreview,
    }));
    setDeadLetterRetryResults((current) => {
      const updated = { ...current };
      delete updated[channelId];
      return updated;
    });
    setDeadLetterRetryConfirmId(undefined);
  };

  const downloadDeadLetters = async (channelId: string): Promise<void> => {
    const operationId = `dead-letters:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      const artifact = await exportInboundDeadLetters(channelId);
      downloadDeadLetterArtifact(artifact);
      setDeadLetterExports((current) => ({
        ...current,
        [channelId]: {
          deliveryCount: artifact.deliveryCount,
          contentSha256: artifact.contentSha256,
          ...deadLetterQualificationSummary(artifact),
        },
      }));
      await inspectDeadLetterArtifact(channelId, artifact);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const verifyDeadLetterArtifactFile = async (
    channelId: string,
    file: File,
  ): Promise<void> => {
    if (file.size > MAX_DEAD_LETTER_EXPORT_FILE_BYTES) {
      setError(copy.deadLetterArtifactTooLarge);
      return;
    }
    const operationId = `verify-dead-letters:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      const artifact = await readJsonFile(file);
      await inspectDeadLetterArtifact(channelId, artifact);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const applyDeadLetterRetryPreview = async (
    channelId: string,
  ): Promise<void> => {
    const artifact = deadLetterRetryArtifacts[channelId];
    const preview = deadLetterRetryPreviews[channelId];
    if (!artifact || !preview) {
      setError(copy.deadLetterRetryPreviewMissing);
      return;
    }
    const operationId = `apply-dead-letters:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      const result = await applyInboundDeadLetterRetry(channelId, {
        artifact,
        expectedPreviewSha256: preview.contentSha256,
        confirmReplay: true,
      });
      setDeadLetterRetryResults((current) => ({
        ...current,
        [channelId]: result,
      }));
      setDeadLetterRetryConfirmId(undefined);
      const refreshedPreview = await previewInboundDeadLetterRetry(channelId, {
        artifact,
      });
      setDeadLetterRetryPreviews((current) => ({
        ...current,
        [channelId]: refreshedPreview,
      }));
      const updatedDeliveries = await getInboundDeliveries(channelId);
      setDeliveries((current) => ({
        ...current,
        [channelId]: updatedDeliveries,
      }));
      const retryHistory = await getInboundDeadLetterRetryHistory(channelId);
      setDeadLetterRetryHistories((current) => ({
        ...current,
        [channelId]: retryHistory,
      }));
      setDeadLetterRetryHistoryVerifications((current) => {
        const updated = { ...current };
        delete updated[channelId];
        return updated;
      });
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const verifyDeadLetterRetryHistoryReceipt = async (
    channelId: string,
  ): Promise<void> => {
    const operationId = `verify-retry-history:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      const history =
        deadLetterRetryHistories[channelId] ??
        (await getInboundDeadLetterRetryHistory(channelId));
      setDeadLetterRetryHistories((current) => ({
        ...current,
        [channelId]: history,
      }));
      const verification = await verifyInboundDeadLetterRetryHistory(
        channelId,
        { history },
      );
      setDeadLetterRetryHistoryVerifications((current) => ({
        ...current,
        [channelId]: verification,
      }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const downloadDeadLetterRetryHistory = async (
    channelId: string,
  ): Promise<void> => {
    const operationId = `download-retry-history:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      const history = await getInboundDeadLetterRetryHistory(channelId);
      downloadDeadLetterRetryHistoryArtifact(history);
      setDeadLetterRetryHistories((current) => ({
        ...current,
        [channelId]: history,
      }));
      setDeadLetterRetryHistoryVerifications((current) => {
        const updated = { ...current };
        delete updated[channelId];
        return updated;
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const verifyDeadLetterRetryHistoryFile = async (
    channelId: string,
    file: File,
  ): Promise<void> => {
    if (file.size > MAX_DEAD_LETTER_EXPORT_FILE_BYTES) {
      setError(copy.deadLetterRetryHistoryArtifactTooLarge);
      return;
    }
    const operationId = `verify-retry-history:${channelId}`;
    setBusyId(operationId);
    setError(undefined);
    try {
      const history = await readJsonFile(file);
      const [verification, currentHistory] = await Promise.all([
        verifyInboundDeadLetterRetryHistory(channelId, { history }),
        getInboundDeadLetterRetryHistory(channelId),
      ]);
      setDeadLetterRetryHistoryVerifications((current) => ({
        ...current,
        [channelId]: verification,
      }));
      setDeadLetterRetryHistories((current) => ({
        ...current,
        [channelId]: currentHistory,
      }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  const copyToken = async (): Promise<void> => {
    if (!createdChannel) return;
    try {
      await navigator.clipboard.writeText(createdChannel.token);
      setTokenCopied(true);
    } catch {
      setTokenCopied(false);
    }
  };

  return (
    <section
      className="panel-section automation-panel"
      aria-labelledby="automation-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.eyebrow}</span>
          <h2 id="automation-title">{copy.title}</h2>
        </div>
        <span className="automation-count">
          {threadSchedules.length +
            threadChannels.length +
            recoveryAttempts.length}
        </span>
      </div>

      {error ? (
        <div className="automation-error" role="alert">
          {error}
        </div>
      ) : null}

      <section
        className="automation-register recovery-register"
        aria-labelledby="recovery-ledger-title"
      >
        <header className="automation-section-heading">
          <span className="automation-glyph recovery" aria-hidden="true">
            <RotateCcw size={14} />
          </span>
          <div>
            <span>{copy.recoveryEyebrow}</span>
            <h3 id="recovery-ledger-title">{copy.recovery}</h3>
          </div>
          <span className="recovery-count">
            {recoveryAttempts.length.toString().padStart(2, "0")}
          </span>
        </header>
        <div className="recovery-summary">
          <div>
            <span>{copy.recoveryQualified}</span>
            <strong>
              {
                recoveryAssessments.filter((assessment) => assessment.eligible)
                  .length
              }
            </strong>
          </div>
          <div>
            <span>{copy.recoveryBlocked}</span>
            <strong>
              {
                recoveryAssessments.filter((assessment) => !assessment.eligible)
                  .length
              }
            </strong>
          </div>
          <div>
            <span>{copy.recoveryCompleted}</span>
            <strong>
              {
                recoveryAttempts.filter(
                  (attempt) => attempt.status === "completed",
                ).length
              }
            </strong>
          </div>
        </div>
        {recoveryAssessments.length === 0 ? (
          <p className="empty-panel">{copy.noRecoveries}</p>
        ) : (
          <div className="recovery-ledger-list">
            {recoveryAssessments
              .slice()
              .reverse()
              .slice(0, 8)
              .map((assessment) => {
                const attempt = recoveryAttempts.find(
                  (candidate) =>
                    candidate.assessmentSha256 === assessment.contentSha256,
                );
                const status = attempt?.status ?? "skipped";
                return (
                  <article
                    className={`recovery-ledger-card state-${status}`}
                    key={assessment.contentSha256}
                  >
                    <header>
                      <div>
                        <span>
                          {copy.recoveryAttempt}{" "}
                          {attempt
                            ? `${attempt.attempt}/${attempt.maxAttempts}`
                            : "—"}
                        </span>
                        <strong>{copy.recoveryStatuses[status]}</strong>
                      </div>
                      <code title={assessment.contentSha256}>
                        {assessment.contentSha256.slice(0, 10)}
                      </code>
                    </header>
                    {assessment.blockReasons.length > 0 ? (
                      <ul>
                        {assessment.blockReasons.map((reason) => (
                          <li key={reason}>{copy.recoveryReasons[reason]}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>{copy.recoveryQualifiedBody}</p>
                    )}
                    <dl>
                      <div>
                        <dt>{copy.recoveryEvents}</dt>
                        <dd>{assessment.eventRange.eventCount}</dd>
                      </div>
                      <div>
                        <dt>{copy.recoveryTools}</dt>
                        <dd>{assessment.toolCalls.total}</dd>
                      </div>
                      <div>
                        <dt>{copy.recoverySource}</dt>
                        <dd title={assessment.runId}>
                          {assessment.runId.slice(-8)}
                        </dd>
                      </div>
                    </dl>
                    <footer>
                      <time dateTime={assessment.assessedAt}>
                        {formatDateTime(assessment.assessedAt)}
                      </time>
                      <code title={assessment.eventRange.eventStreamSha256}>
                        EV {assessment.eventRange.eventStreamSha256.slice(0, 8)}
                      </code>
                    </footer>
                  </article>
                );
              })}
          </div>
        )}
        <p className="automation-safety">
          <ShieldCheck size={12} aria-hidden="true" />
          {copy.recoverySafety}
        </p>
      </section>

      <section
        className="automation-register"
        aria-labelledby="schedules-title"
      >
        <header className="automation-section-heading">
          <span className="automation-glyph" aria-hidden="true">
            <CalendarClock size={14} />
          </span>
          <div>
            <span>{copy.scheduleEyebrow}</span>
            <h3 id="schedules-title">{copy.schedules}</h3>
          </div>
        </header>
        <form
          className="automation-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void addSchedule();
          }}
        >
          <label className="automation-field">
            <span>{copy.scheduleName}</span>
            <input
              required
              maxLength={100}
              value={scheduleName}
              placeholder={copy.scheduleNamePlaceholder}
              onChange={(event) => setScheduleName(event.target.value)}
            />
          </label>
          <label className="automation-field">
            <span>{copy.prompt}</span>
            <textarea
              required
              rows={4}
              maxLength={20_000}
              value={prompt}
              placeholder={copy.promptPlaceholder}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="automation-field-grid">
            <label className="automation-field">
              <span>{copy.triggerType}</span>
              <select
                value={triggerType}
                onChange={(event) =>
                  setTriggerType(event.target.value as "interval" | "cron")
                }
              >
                <option value="interval">{copy.interval}</option>
                <option value="cron">{copy.cron}</option>
              </select>
            </label>
            {triggerType === "interval" ? (
              <label className="automation-field">
                <span>{copy.intervalMinutes}</span>
                <input
                  type="number"
                  min={1}
                  max={43_200}
                  value={intervalMinutes}
                  onChange={(event) => {
                    if (Number.isFinite(event.target.valueAsNumber)) {
                      setIntervalMinutes(event.target.valueAsNumber);
                    }
                  }}
                />
              </label>
            ) : (
              <label className="automation-field">
                <span>{copy.cronExpression}</span>
                <input
                  value={cronExpression}
                  placeholder={copy.cronPlaceholder}
                  onChange={(event) => setCronExpression(event.target.value)}
                />
              </label>
            )}
          </div>
          <button
            className="automation-primary"
            type="submit"
            disabled={!canCreateSchedule || Boolean(busyId)}
          >
            <Plus size={12} aria-hidden="true" />
            {busyId === "new-schedule" ? copy.creating : copy.createSchedule}
          </button>
        </form>

        {threadSchedules.length === 0 ? (
          <p className="empty-panel">{copy.noSchedules}</p>
        ) : (
          <div className="automation-card-list">
            {threadSchedules.map((schedule) => (
              <article className="schedule-card" key={schedule.id}>
                <header>
                  <div>
                    <span>{schedule.trigger.type}</span>
                    <strong>{schedule.name}</strong>
                  </div>
                  <span className={`automation-state state-${schedule.status}`}>
                    {schedule.status === "active" ? copy.active : copy.paused}
                  </span>
                </header>
                <p>{schedule.prompt}</p>
                <dl>
                  <div>
                    <dt>{copy.nextRun}</dt>
                    <dd>{formatDateTime(schedule.nextRunAt)}</dd>
                  </div>
                  <div>
                    <dt>{copy.lastRun}</dt>
                    <dd>
                      {schedule.lastRunAt
                        ? formatDateTime(schedule.lastRunAt)
                        : copy.never}
                    </dd>
                  </div>
                </dl>
                <footer>
                  {schedule.claim ? (
                    <span>
                      {copy.claim} · {schedule.claim.ownerId}
                    </span>
                  ) : (
                    <span>
                      {copy.revision} {schedule.revision}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busyId === schedule.id}
                    onClick={() => void toggleSchedule(schedule)}
                  >
                    {schedule.status === "active" ? (
                      <Pause size={10} aria-hidden="true" />
                    ) : (
                      <Play size={10} aria-hidden="true" />
                    )}
                    {schedule.status === "active" ? copy.pause : copy.resume}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
        <p className="automation-safety">
          <ShieldCheck size={12} aria-hidden="true" />
          {copy.scheduleSafety}
        </p>
      </section>

      <section className="automation-register" aria-labelledby="channels-title">
        <header className="automation-section-heading">
          <span className="automation-glyph channel" aria-hidden="true">
            <Webhook size={14} />
          </span>
          <div>
            <span>{copy.channelEyebrow}</span>
            <h3 id="channels-title">{copy.channels}</h3>
          </div>
        </header>
        <form
          className="automation-compose channel-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void addChannel();
          }}
        >
          <label className="automation-field">
            <span>{copy.channelName}</span>
            <input
              required
              maxLength={100}
              value={channelName}
              placeholder={copy.channelNamePlaceholder}
              onChange={(event) => setChannelName(event.target.value)}
            />
          </label>
          <label className="automation-field">
            <span>{copy.channelAdapter}</span>
            <select
              value={channelAdapter}
              onChange={(event) =>
                setChannelAdapter(
                  event.currentTarget.value as InboundChannelAdapter,
                )
              }
            >
              {inboundChannelAdapters.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>
                  {adapter.label}
                </option>
              ))}
            </select>
          </label>
          <label className="automation-field">
            <span>{copy.policyTemplate}</span>
            <select
              value={channelPolicyTemplate}
              onChange={(event) =>
                selectChannelPolicyTemplate(
                  event.currentTarget.value as InboundChannelPolicyTemplateId,
                )
              }
            >
              {CHANNEL_POLICY_TEMPLATE_IDS.map((templateId) => (
                <option key={templateId} value={templateId}>
                  {copy.policyTemplateLabels[templateId]}
                </option>
              ))}
            </select>
          </label>
          <div className="automation-field-grid">
            <label className="automation-field">
              <span>{copy.maxAttempts}</span>
              <input
                type="number"
                min={1}
                max={10}
                value={channelMaxAttempts}
                onChange={(event) => {
                  if (Number.isFinite(event.target.valueAsNumber)) {
                    setChannelPolicyTemplate("custom");
                    setChannelMaxAttempts(event.target.valueAsNumber);
                  }
                }}
              />
            </label>
            <label className="automation-field">
              <span>{copy.retryBaseSeconds}</span>
              <input
                type="number"
                min={0.25}
                max={60}
                step={0.25}
                value={channelRetrySeconds}
                onChange={(event) => {
                  if (Number.isFinite(event.target.valueAsNumber)) {
                    setChannelPolicyTemplate("custom");
                    setChannelRetrySeconds(event.target.valueAsNumber);
                  }
                }}
              />
            </label>
          </div>
          <label className="automation-check-field">
            <input
              type="checkbox"
              checked={channelSignatureRequired}
              onChange={(event) => {
                setChannelPolicyTemplate("custom");
                setChannelSignatureRequired(event.target.checked);
              }}
            />
            <span>{copy.requireSignature}</span>
          </label>
          <button
            className="automation-primary"
            type="submit"
            disabled={!canCreateChannel || Boolean(busyId)}
          >
            <Plus size={12} aria-hidden="true" />
            {copy.createChannel}
          </button>
        </form>

        {createdChannel ? (
          <aside
            className="channel-token"
            aria-labelledby="channel-token-title"
          >
            <header>
              <KeyRound size={14} aria-hidden="true" />
              <strong id="channel-token-title">{copy.tokenTitle}</strong>
            </header>
            <p>{copy.tokenBody}</p>
            <label>
              <span>{copy.endpoint}</span>
              <code>{endpoint}</code>
            </label>
            <label>
              <span>{copy.bearerToken}</span>
              <output>{createdChannel.token}</output>
            </label>
            <footer>
              <button type="button" onClick={() => void copyToken()}>
                {tokenCopied ? <Check size={10} /> : <KeyRound size={10} />}
                {tokenCopied ? copy.copied : copy.copyToken}
              </button>
              <button
                type="button"
                onClick={() => setCreatedChannel(undefined)}
              >
                {copy.dismiss}
              </button>
            </footer>
          </aside>
        ) : null}

        {threadChannels.length === 0 ? (
          <p className="empty-panel">{copy.noChannels}</p>
        ) : (
          <div className="automation-card-list">
            {threadChannels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                adapterDescriptor={adapterById.get(channel.adapter)}
                deliveries={deliveries[channel.id]}
                busyId={busyId}
                rotatePending={rotateConfirmId === channel.id}
                retryConfirmId={retryConfirmId}
                onToggle={() => void toggleChannel(channel)}
                onRequestRotate={() => setRotateConfirmId(channel.id)}
                onCancelRotate={() => setRotateConfirmId(undefined)}
                onRotate={() => void rotateChannelToken(channel)}
                onLoad={() => void loadDeliveries(channel.id)}
                onPreview={(body, headersText) =>
                  previewChannelAdapter(channel.id, body, headersText)
                }
                onRequestRetry={setRetryConfirmId}
                onCancelRetry={() => setRetryConfirmId(undefined)}
                onRetry={(deliveryId) =>
                  void retryDelivery(channel.id, deliveryId)
                }
                onQualifyDelivery={(deliveryId) =>
                  void qualifyDelivery(channel.id, deliveryId)
                }
                onUpdatePolicy={(policy) =>
                  saveChannelRetryPolicy(channel.id, policy)
                }
                onUpdateSignaturePolicy={(policy) =>
                  saveChannelSignaturePolicy(channel.id, policy)
                }
                onExportDeadLetters={() => void downloadDeadLetters(channel.id)}
                onVerifyDeadLetters={(file) =>
                  void verifyDeadLetterArtifactFile(channel.id, file)
                }
                onDownloadDeadLetterRetryHistory={() =>
                  void downloadDeadLetterRetryHistory(channel.id)
                }
                onVerifyDeadLetterRetryHistoryFile={(file) =>
                  void verifyDeadLetterRetryHistoryFile(channel.id, file)
                }
                onRequestDeadLetterRetry={() =>
                  setDeadLetterRetryConfirmId(channel.id)
                }
                onCancelDeadLetterRetry={() =>
                  setDeadLetterRetryConfirmId(undefined)
                }
                onApplyDeadLetterRetry={() =>
                  void applyDeadLetterRetryPreview(channel.id)
                }
                adapterPreview={adapterPreviews[channel.id]}
                deadLetterExport={deadLetterExports[channel.id]}
                deadLetterVerification={deadLetterVerifications[channel.id]}
                deadLetterRetryPreview={deadLetterRetryPreviews[channel.id]}
                deadLetterRetryResult={deadLetterRetryResults[channel.id]}
                deadLetterRetryHistory={deadLetterRetryHistories[channel.id]}
                deadLetterRetryHistoryVerification={
                  deadLetterRetryHistoryVerifications[channel.id]
                }
                deadLetterRetryConfirming={
                  deadLetterRetryConfirmId === channel.id
                }
                onVerifyDeadLetterRetryHistory={() =>
                  void verifyDeadLetterRetryHistoryReceipt(channel.id)
                }
                deliveryQualifications={deliveryQualifications}
              />
            ))}
          </div>
        )}
        <p className="automation-safety">
          <ShieldCheck size={12} aria-hidden="true" />
          {copy.channelSafety}
        </p>
      </section>
    </section>
  );
}

function ChannelCard({
  channel,
  adapterDescriptor,
  deliveries,
  busyId,
  rotatePending,
  retryConfirmId,
  onToggle,
  onRequestRotate,
  onCancelRotate,
  onRotate,
  onLoad,
  onPreview,
  onRequestRetry,
  onCancelRetry,
  onRetry,
  onQualifyDelivery,
  onUpdatePolicy,
  onUpdateSignaturePolicy,
  onExportDeadLetters,
  onVerifyDeadLetters,
  onDownloadDeadLetterRetryHistory,
  onVerifyDeadLetterRetryHistoryFile,
  onRequestDeadLetterRetry,
  onCancelDeadLetterRetry,
  onApplyDeadLetterRetry,
  adapterPreview,
  deadLetterExport,
  deadLetterVerification,
  deadLetterRetryPreview,
  deadLetterRetryResult,
  deadLetterRetryHistory,
  deadLetterRetryHistoryVerification,
  deadLetterRetryConfirming,
  onVerifyDeadLetterRetryHistory,
  deliveryQualifications,
}: {
  channel: InboundChannel;
  adapterDescriptor: InboundChannelAdapterDescriptor | undefined;
  deliveries: InboundDelivery[] | undefined;
  busyId: string | undefined;
  rotatePending: boolean;
  retryConfirmId: string | undefined;
  onToggle: () => void;
  onRequestRotate: () => void;
  onCancelRotate: () => void;
  onRotate: () => void;
  onLoad: () => void;
  onPreview: (body: string, headersText: string) => Promise<boolean>;
  onRequestRetry: (deliveryId: string) => void;
  onCancelRetry: () => void;
  onRetry: (deliveryId: string) => void;
  onQualifyDelivery: (deliveryId: string) => void;
  onUpdatePolicy: (policy: InboundRetryPolicy) => Promise<boolean>;
  onUpdateSignaturePolicy: (
    policy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ) => Promise<boolean>;
  onExportDeadLetters: () => void;
  onVerifyDeadLetters: (file: File) => void;
  onDownloadDeadLetterRetryHistory: () => void;
  onVerifyDeadLetterRetryHistoryFile: (file: File) => void;
  onRequestDeadLetterRetry: () => void;
  onCancelDeadLetterRetry: () => void;
  onApplyDeadLetterRetry: () => void;
  adapterPreview: InboundChannelAdapterPreview | undefined;
  deadLetterExport:
    | {
        deliveryCount: number;
        contentSha256: string;
        qualifiedCount: number;
        evidenceMissingCount: number;
        adapterCatalogDriftCount: number;
      }
    | undefined;
  deadLetterVerification: InboundDeadLetterExportVerification | undefined;
  deadLetterRetryPreview: InboundDeadLetterRetryPreview | undefined;
  deadLetterRetryResult: InboundDeadLetterRetryApplyResult | undefined;
  deadLetterRetryHistory: InboundDeadLetterRetryHistory | undefined;
  deadLetterRetryHistoryVerification:
    | InboundDeadLetterRetryHistoryVerification
    | undefined;
  deadLetterRetryConfirming: boolean;
  onVerifyDeadLetterRetryHistory: () => void;
  deliveryQualifications: Record<string, InboundDeliveryQualification>;
}) {
  const rotating = busyId === `rotate:${channel.id}`;
  const policySaving = busyId === `policy:${channel.id}`;
  const signaturePolicySaving = busyId === `signature-policy:${channel.id}`;
  const exportingDeadLetters = busyId === `dead-letters:${channel.id}`;
  const verifyingDeadLetters = busyId === `verify-dead-letters:${channel.id}`;
  const applyingDeadLetters = busyId === `apply-dead-letters:${channel.id}`;
  const verifyingRetryHistory = busyId === `verify-retry-history:${channel.id}`;
  const downloadingRetryHistory =
    busyId === `download-retry-history:${channel.id}`;
  const previewing = busyId === `preview:${channel.id}`;
  const [editingPreview, setEditingPreview] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [editingSignaturePolicy, setEditingSignaturePolicy] = useState(false);
  const [previewBody, setPreviewBody] = useState(
    adapterSampleBody(adapterDescriptor),
  );
  const [previewHeadersText, setPreviewHeadersText] = useState(
    adapterSampleHeadersText(adapterDescriptor),
  );
  const [policyMaxAttempts, setPolicyMaxAttempts] = useState(
    channel.retryPolicy.maxAttempts,
  );
  const [policyRetrySeconds, setPolicyRetrySeconds] = useState(
    channel.retryPolicy.baseDelayMs / 1_000,
  );
  const [signatureRequired, setSignatureRequired] = useState(
    channel.signaturePolicy.required,
  );
  const [signatureToleranceSeconds, setSignatureToleranceSeconds] = useState(
    channel.signaturePolicy.toleranceSeconds,
  );
  const latestDeadLetterRetryHistory =
    deadLetterRetryHistory?.records[deadLetterRetryHistory.records.length - 1];
  const beginPolicyEdit = (): void => {
    setPolicyMaxAttempts(channel.retryPolicy.maxAttempts);
    setPolicyRetrySeconds(channel.retryPolicy.baseDelayMs / 1_000);
    setEditingPolicy(true);
  };
  const beginSignaturePolicyEdit = (): void => {
    setSignatureRequired(channel.signaturePolicy.required);
    setSignatureToleranceSeconds(channel.signaturePolicy.toleranceSeconds);
    setEditingSignaturePolicy(true);
  };
  const beginPreviewEdit = (): void => {
    setPreviewBody(adapterSampleBody(adapterDescriptor));
    setPreviewHeadersText(adapterSampleHeadersText(adapterDescriptor));
    setEditingPreview(true);
  };
  const savePreview = async (): Promise<void> => {
    const saved = await onPreview(previewBody, previewHeadersText);
    if (saved) setEditingPreview(false);
  };
  const savePolicy = async (): Promise<void> => {
    const saved = await onUpdatePolicy({
      maxAttempts: policyMaxAttempts,
      baseDelayMs: Math.round(policyRetrySeconds * 1_000),
    });
    if (saved) setEditingPolicy(false);
  };
  const saveSignaturePolicy = async (): Promise<void> => {
    const saved = await onUpdateSignaturePolicy({
      required: signatureRequired,
      toleranceSeconds: signatureToleranceSeconds,
    });
    if (saved) setEditingSignaturePolicy(false);
  };
  return (
    <article className="channel-card">
      <header>
        <div>
          <span>{copy.webhook}</span>
          <strong>{channel.name}</strong>
        </div>
        <span className={`automation-state state-${channel.status}`}>
          {channel.status === "active" ? copy.active : copy.paused}
        </span>
      </header>
      <code>/api/channels/{channel.id}/inbound</code>
      <p>
        {copy.fingerprint}: {channel.tokenFingerprint}
      </p>
      <p className="channel-policy-summary">
        {copy.channelAdapter}: {adapterDescriptor?.label ?? channel.adapter}
      </p>
      {adapterDescriptor ? (
        <p className="channel-policy-summary">
          {adapterDescriptor.description}
        </p>
      ) : null}
      {adapterDescriptor ? (
        <p className="channel-policy-summary">
          {copy.idempotencySource}: {adapterDescriptor.idempotencySource}
        </p>
      ) : null}
      <p className="channel-policy-summary">
        {copy.policyTemplate}:{" "}
        {copy.policyTemplateLabels[channel.policyTemplate]}
      </p>
      <p className="channel-policy-summary">
        {copy.retryPolicy}: {channel.retryPolicy.maxAttempts}{" "}
        {copy.policyAttempts} ·{" "}
        {formatDuration(channel.retryPolicy.baseDelayMs)} {copy.policyBase}
      </p>
      <p className="channel-policy-summary">
        {copy.signaturePolicy}:{" "}
        {channel.signaturePolicy.required
          ? `${copy.signatureRequired} · ${channel.signaturePolicy.toleranceSeconds}s`
          : copy.signatureOptional}
      </p>
      <footer>
        <button
          type="button"
          disabled={busyId === channel.id}
          onClick={onToggle}
        >
          {channel.status === "active" ? copy.disable : copy.enable}
        </button>
        <button type="button" disabled={rotating} onClick={onRequestRotate}>
          <KeyRound size={10} aria-hidden="true" />
          {copy.rotateToken}
        </button>
        <button type="button" disabled={policySaving} onClick={beginPolicyEdit}>
          <SlidersHorizontal size={10} aria-hidden="true" />
          {copy.editPolicy}
        </button>
        <button
          type="button"
          disabled={signaturePolicySaving}
          onClick={beginSignaturePolicyEdit}
        >
          <ShieldCheck size={10} aria-hidden="true" />
          {copy.editSignaturePolicy}
        </button>
        <button type="button" disabled={previewing} onClick={beginPreviewEdit}>
          <Check size={10} aria-hidden="true" />
          {copy.previewAdapter}
        </button>
        <button
          type="button"
          disabled={busyId === `deliveries:${channel.id}`}
          onClick={onLoad}
        >
          <Inbox size={10} aria-hidden="true" />
          {copy.loadDeliveries}
        </button>
        <label
          className="channel-file-action"
          aria-disabled={verifyingDeadLetters}
        >
          <ShieldCheck size={10} aria-hidden="true" />
          {verifyingDeadLetters
            ? copy.verifyingDeadLetterExport
            : copy.verifyDeadLetterExport}
          <input
            type="file"
            accept="application/json,.json"
            disabled={verifyingDeadLetters}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onVerifyDeadLetters(file);
            }}
          />
        </label>
        <button
          type="button"
          disabled={exportingDeadLetters}
          onClick={onExportDeadLetters}
        >
          <Download size={10} aria-hidden="true" />
          {exportingDeadLetters ? copy.exporting : copy.exportDeadLetters}
        </button>
      </footer>
      {rotatePending ? (
        <div
          className="channel-rotate-confirm"
          role="group"
          aria-labelledby={`rotate-title-${channel.id}`}
        >
          <strong id={`rotate-title-${channel.id}`}>{copy.rotateTitle}</strong>
          <p>{copy.rotateBody}</p>
          <div>
            <button type="button" disabled={rotating} onClick={onCancelRotate}>
              {copy.cancel}
            </button>
            <button
              className="danger"
              type="button"
              disabled={rotating}
              onClick={onRotate}
            >
              {rotating ? copy.rotating : copy.rotateNow}
            </button>
          </div>
        </div>
      ) : null}
      {editingPreview ? (
        <form
          className="channel-policy-editor channel-adapter-preview"
          onSubmit={(event) => {
            event.preventDefault();
            void savePreview();
          }}
        >
          <strong>{copy.previewTitle}</strong>
          <p>{copy.previewBody}</p>
          {adapterDescriptor ? <p>{adapterDescriptor.securityNote}</p> : null}
          <label className="automation-field">
            <span>{copy.previewHeaders}</span>
            <textarea
              spellCheck={false}
              value={previewHeadersText}
              onChange={(event) => setPreviewHeadersText(event.target.value)}
            />
          </label>
          <label className="automation-field">
            <span>{copy.previewPayload}</span>
            <textarea
              required
              spellCheck={false}
              value={previewBody}
              onChange={(event) => setPreviewBody(event.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              disabled={previewing}
              onClick={() => setEditingPreview(false)}
            >
              {copy.cancel}
            </button>
            <button
              type="submit"
              disabled={previewing || previewBody.trim().length === 0}
            >
              {previewing ? copy.previewing : copy.previewNow}
            </button>
          </div>
        </form>
      ) : null}
      {editingPolicy ? (
        <form
          className="channel-policy-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void savePolicy();
          }}
        >
          <strong>{copy.policyTitle}</strong>
          <p>{copy.policyBody}</p>
          <div className="automation-field-grid">
            <label className="automation-field">
              <span>{copy.maxAttempts}</span>
              <input
                type="number"
                min={1}
                max={10}
                value={policyMaxAttempts}
                onChange={(event) => {
                  if (Number.isFinite(event.target.valueAsNumber)) {
                    setPolicyMaxAttempts(event.target.valueAsNumber);
                  }
                }}
              />
            </label>
            <label className="automation-field">
              <span>{copy.retryBaseSeconds}</span>
              <input
                type="number"
                min={0.25}
                max={60}
                step={0.25}
                value={policyRetrySeconds}
                onChange={(event) => {
                  if (Number.isFinite(event.target.valueAsNumber)) {
                    setPolicyRetrySeconds(event.target.valueAsNumber);
                  }
                }}
              />
            </label>
          </div>
          <div>
            <button
              type="button"
              disabled={policySaving}
              onClick={() => setEditingPolicy(false)}
            >
              {copy.cancel}
            </button>
            <button
              type="submit"
              disabled={
                policySaving ||
                !Number.isInteger(policyMaxAttempts) ||
                policyMaxAttempts < 1 ||
                policyMaxAttempts > 10 ||
                !Number.isFinite(policyRetrySeconds) ||
                policyRetrySeconds < 0.25 ||
                policyRetrySeconds > 60
              }
            >
              {policySaving ? copy.savingPolicy : copy.savePolicy}
            </button>
          </div>
        </form>
      ) : null}
      {editingSignaturePolicy ? (
        <form
          className="channel-policy-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSignaturePolicy();
          }}
        >
          <strong>{copy.signaturePolicyTitle}</strong>
          <p>{copy.signaturePolicyBody}</p>
          <label className="automation-check-field">
            <input
              type="checkbox"
              checked={signatureRequired}
              onChange={(event) =>
                setSignatureRequired(event.currentTarget.checked)
              }
            />
            <span>{copy.requireSignature}</span>
          </label>
          <label className="automation-field">
            <span>{copy.signatureToleranceSeconds}</span>
            <input
              type="number"
              min={30}
              max={900}
              step={1}
              value={signatureToleranceSeconds}
              onChange={(event) => {
                if (Number.isFinite(event.target.valueAsNumber)) {
                  setSignatureToleranceSeconds(event.target.valueAsNumber);
                }
              }}
            />
          </label>
          <div>
            <button
              type="button"
              disabled={signaturePolicySaving}
              onClick={() => setEditingSignaturePolicy(false)}
            >
              {copy.cancel}
            </button>
            <button
              type="submit"
              disabled={
                signaturePolicySaving ||
                !Number.isInteger(signatureToleranceSeconds) ||
                signatureToleranceSeconds < 30 ||
                signatureToleranceSeconds > 900
              }
            >
              {signaturePolicySaving ? copy.savingPolicy : copy.savePolicy}
            </button>
          </div>
        </form>
      ) : null}
      {adapterPreview ? (
        <div className="channel-preview-receipt" role="status">
          <strong>{copy.previewReceipt}</strong>
          <p>
            {copy.fingerprint}: {adapterPreview.idempotencyFingerprint} ·{" "}
            <code title={adapterPreview.contentSha256}>
              {copy.previewReceiptHash}{" "}
              {adapterPreview.contentSha256.slice(0, 12)}
            </code>{" "}
            ·{" "}
            <code title={adapterPreview.messageSha256}>
              {copy.previewMessageHash}{" "}
              {adapterPreview.messageSha256.slice(0, 12)}
            </code>
          </p>
          <blockquote>{adapterPreview.messagePreview}</blockquote>
        </div>
      ) : null}
      {deadLetterExport ? (
        <p className="dead-letter-receipt" role="status">
          {copy.exported} {deadLetterExport.deliveryCount} ·{" "}
          <code title={deadLetterExport.contentSha256}>
            SHA-256 {deadLetterExport.contentSha256.slice(0, 12)}
          </code>
          <span>
            {copy.qualifiedShort} {deadLetterExport.qualifiedCount} ·{" "}
            {copy.missingShort} {deadLetterExport.evidenceMissingCount} ·{" "}
            {copy.driftShort} {deadLetterExport.adapterCatalogDriftCount}
          </span>
        </p>
      ) : null}
      {deadLetterVerification ? (
        <p
          className={`dead-letter-receipt verification-${deadLetterVerification.status}`}
          role="status"
        >
          {deadLetterVerification.status === "valid"
            ? copy.deadLetterVerificationValid
            : copy.deadLetterVerificationInvalid}{" "}
          ·{" "}
          <code title={deadLetterVerificationHash(deadLetterVerification)}>
            SHA-256{" "}
            {deadLetterVerificationHash(deadLetterVerification).slice(0, 12)}
          </code>
          <span>
            {copy.qualifiedShort}{" "}
            {deadLetterVerification.observedQualifiedCount ??
              deadLetterVerification.qualifiedCount ??
              0}{" "}
            · {copy.missingShort}{" "}
            {deadLetterVerification.observedEvidenceMissingCount ??
              deadLetterVerification.evidenceMissingCount ??
              0}{" "}
            · {copy.driftShort}{" "}
            {deadLetterVerification.observedAdapterCatalogDriftCount ??
              deadLetterVerification.adapterCatalogDriftCount ??
              0}
          </span>
          {deadLetterVerification.diagnostics[0] ? (
            <small>{deadLetterVerification.diagnostics[0]}</small>
          ) : null}
        </p>
      ) : null}
      {deadLetterRetryPreview ? (
        <div
          className={`dead-letter-retry-receipt ${
            deadLetterRetryPreview.retryableCount > 0 &&
            deadLetterRetryPreview.verificationStatus === "valid"
              ? "verification-valid"
              : "verification-invalid"
          }`}
          role="status"
        >
          <strong>{copy.deadLetterRetryPreview}</strong>
          <p>
            {copy.retryableShort} {deadLetterRetryPreview.retryableCount} ·{" "}
            {copy.blockedShort} {deadLetterRetryPreview.blockedCount} ·{" "}
            <code title={deadLetterRetryPreview.candidateSetSha256}>
              Set {deadLetterRetryPreview.candidateSetSha256.slice(0, 12)}
            </code>{" "}
            ·{" "}
            <code title={deadLetterRetryPreview.contentSha256}>
              Preview {deadLetterRetryPreview.contentSha256.slice(0, 12)}
            </code>
          </p>
          {deadLetterRetryPreview.candidates[0] ? (
            <small>
              {deadLetterRetryPreview.candidates[0].deliveryId}:{" "}
              {
                copy.deadLetterRetryCandidateStatuses[
                  deadLetterRetryPreview.candidates[0].status
                ]
              }
            </small>
          ) : null}
          {deadLetterRetryPreview.diagnostics[0] ? (
            <small>{deadLetterRetryPreview.diagnostics[0]}</small>
          ) : null}
          {deadLetterRetryPreview.retryableCount > 0 &&
          deadLetterRetryPreview.verificationStatus === "valid" ? (
            deadLetterRetryConfirming ? (
              <div className="dead-letter-retry-confirm">
                <p>{copy.deadLetterRetryConfirmBody}</p>
                <button
                  type="button"
                  disabled={applyingDeadLetters}
                  onClick={onCancelDeadLetterRetry}
                >
                  {copy.cancel}
                </button>
                <button
                  type="button"
                  disabled={applyingDeadLetters}
                  onClick={onApplyDeadLetterRetry}
                >
                  {applyingDeadLetters
                    ? copy.applyingDeadLetterRetry
                    : copy.applyDeadLetterRetryNow}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={applyingDeadLetters}
                onClick={onRequestDeadLetterRetry}
              >
                {copy.applyDeadLetterRetry}
              </button>
            )
          ) : null}
        </div>
      ) : null}
      {deadLetterRetryResult ? (
        <p className="dead-letter-receipt" role="status">
          {copy.deadLetterRetryApplied} {deadLetterRetryResult.retriedCount} ·{" "}
          {copy.blockedShort} {deadLetterRetryResult.skippedCount} ·{" "}
          <code title={deadLetterRetryResult.previewCandidateSetSha256}>
            Preview set{" "}
            {deadLetterRetryResult.previewCandidateSetSha256.slice(0, 12)}
          </code>{" "}
          ·{" "}
          <code title={deadLetterRetryResult.retriedDeliveryIdsSha256}>
            Retried{" "}
            {deadLetterRetryResult.retriedDeliveryIdsSha256.slice(0, 12)}
          </code>{" "}
          ·{" "}
          <code title={deadLetterRetryResult.contentSha256}>
            Result {deadLetterRetryResult.contentSha256.slice(0, 12)}
          </code>
        </p>
      ) : null}
      {deadLetterRetryHistory ? (
        <div className="dead-letter-retry-history" role="status">
          <strong>{copy.deadLetterRetryHistory}</strong>
          <p>
            {copy.deadLetterRetryHistoryEvents}{" "}
            {deadLetterRetryHistory.eventCount} ·{" "}
            <code title={deadLetterRetryHistory.eventSetSha256}>
              {copy.deadLetterRetryHistorySet}{" "}
              {deadLetterRetryHistory.eventSetSha256.slice(0, 12)}
            </code>{" "}
            ·{" "}
            <code title={deadLetterRetryHistory.contentSha256}>
              History {deadLetterRetryHistory.contentSha256.slice(0, 12)}
            </code>
          </p>
          {latestDeadLetterRetryHistory ? (
            <small>
              {copy.deadLetterRetryHistoryLatest}{" "}
              {formatDateTime(latestDeadLetterRetryHistory.createdAt)} ·{" "}
              {latestDeadLetterRetryHistory.applyResultSha256 ? (
                <>
                  <code title={latestDeadLetterRetryHistory.applyResultSha256}>
                    {copy.deadLetterRetryHistoryApply}{" "}
                    {latestDeadLetterRetryHistory.applyResultSha256.slice(
                      0,
                      12,
                    )}
                  </code>{" "}
                  ·{" "}
                </>
              ) : null}
              <code title={latestDeadLetterRetryHistory.previewSha256}>
                Preview{" "}
                {latestDeadLetterRetryHistory.previewSha256.slice(0, 12)}
              </code>{" "}
              ·{" "}
              <code
                title={latestDeadLetterRetryHistory.retriedDeliveryIdsSha256}
              >
                Retried{" "}
                {latestDeadLetterRetryHistory.retriedDeliveryIdsSha256.slice(
                  0,
                  12,
                )}
              </code>
            </small>
          ) : (
            <small>{copy.deadLetterRetryHistoryEmpty}</small>
          )}
          {deadLetterRetryHistoryVerification ? (
            <small>
              {deadLetterRetryHistoryVerification.status === "valid"
                ? copy.deadLetterRetryHistoryVerificationValid
                : copy.deadLetterRetryHistoryVerificationInvalid}{" "}
              ·{" "}
              <code title={deadLetterRetryHistoryVerification.contentSha256}>
                Verify{" "}
                {deadLetterRetryHistoryVerification.contentSha256.slice(0, 12)}
              </code>
              {deadLetterRetryHistoryVerification.observedEventSetSha256 ? (
                <>
                  {" "}
                  ·{" "}
                  <code
                    title={
                      deadLetterRetryHistoryVerification.observedEventSetSha256
                    }
                  >
                    Observed{" "}
                    {deadLetterRetryHistoryVerification.observedEventSetSha256.slice(
                      0,
                      12,
                    )}
                  </code>
                </>
              ) : null}
              {deadLetterRetryHistoryVerification.diagnostics[0] ? (
                <> · {deadLetterRetryHistoryVerification.diagnostics[0]}</>
              ) : null}
            </small>
          ) : null}
          <button
            type="button"
            disabled={downloadingRetryHistory}
            onClick={onDownloadDeadLetterRetryHistory}
          >
            {downloadingRetryHistory
              ? copy.downloadingDeadLetterRetryHistory
              : copy.downloadDeadLetterRetryHistory}
          </button>
          <label
            className="channel-file-action"
            aria-disabled={verifyingRetryHistory}
          >
            {verifyingRetryHistory
              ? copy.verifyingDeadLetterRetryHistory
              : copy.verifyDeadLetterRetryHistoryFile}
            <input
              type="file"
              accept="application/json,.json"
              disabled={verifyingRetryHistory}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) onVerifyDeadLetterRetryHistoryFile(file);
              }}
            />
          </label>
          <button
            type="button"
            disabled={verifyingRetryHistory}
            onClick={onVerifyDeadLetterRetryHistory}
          >
            {verifyingRetryHistory
              ? copy.verifyingDeadLetterRetryHistory
              : copy.verifyDeadLetterRetryHistory}
          </button>
        </div>
      ) : null}
      {deliveries ? (
        <div className="delivery-list">
          <span>{copy.deliveries}</span>
          {deliveries.length === 0 ? (
            <p>{copy.noDeliveries}</p>
          ) : (
            deliveries
              .slice()
              .reverse()
              .slice(0, 8)
              .map((delivery) => {
                const retryable =
                  delivery.status === "failed" &&
                  delivery.attemptCount < delivery.maxAttempts;
                const retrying = busyId === `retry:${delivery.id}`;
                const qualifying = busyId === `qualify:${delivery.id}`;
                const confirming = retryConfirmId === delivery.id;
                const qualification = deliveryQualifications[delivery.id];
                return (
                  <article className="delivery-entry" key={delivery.id}>
                    <div className="delivery-summary">
                      <i
                        className={`delivery-dot state-${delivery.status}`}
                        aria-hidden="true"
                      />
                      <span>{copy.statuses[delivery.status]}</span>
                      <span className="delivery-attempt">
                        {copy.attempt} {delivery.attemptCount}/
                        {delivery.maxAttempts}
                      </span>
                      <time dateTime={delivery.createdAt}>
                        {formatDateTime(delivery.createdAt)}
                      </time>
                    </div>
                    {delivery.nextAttemptAt ? (
                      <p className="delivery-next">
                        {copy.nextAttempt} ·{" "}
                        <time dateTime={delivery.nextAttemptAt}>
                          {formatDateTime(delivery.nextAttemptAt)}
                        </time>
                      </p>
                    ) : null}
                    {delivery.error ? (
                      <p className="delivery-error">{delivery.error}</p>
                    ) : null}
                    {qualification ? (
                      <div
                        className={`delivery-qualification state-${qualification.status}`}
                        role="status"
                      >
                        <strong>
                          {copy.deliveryQualification}:{" "}
                          {copy.qualificationStatuses[qualification.status]}
                        </strong>
                        <p>
                          {copy.qualificationReceipt}{" "}
                          {shortHash(qualification.contentSha256)}
                        </p>
                        <p>
                          {copy.bodyHash} {shortHash(qualification.bodySha256)}{" "}
                          · {copy.catalogHash}{" "}
                          {shortHash(qualification.adapterCatalogSha256)}
                        </p>
                        {qualification.status === "adapter_catalog_drift" ? (
                          <p>
                            {copy.currentCatalogHash}{" "}
                            {shortHash(
                              qualification.currentAdapterCatalogSha256,
                            )}
                          </p>
                        ) : null}
                        <ul>
                          {qualification.diagnostics.map((diagnostic) => (
                            <li key={diagnostic}>{diagnostic}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      disabled={qualifying}
                      onClick={() => onQualifyDelivery(delivery.id)}
                    >
                      <ShieldCheck size={9} aria-hidden="true" />
                      {qualifying ? copy.qualifying : copy.qualifyDelivery}
                    </button>
                    {retryable && !confirming ? (
                      <button
                        type="button"
                        disabled={retrying}
                        onClick={() => onRequestRetry(delivery.id)}
                      >
                        <RotateCcw size={9} aria-hidden="true" />
                        {copy.retryDelivery}
                      </button>
                    ) : null}
                    {delivery.status === "failed" && !retryable ? (
                      <p className="delivery-exhausted">
                        {copy.retryExhausted}
                      </p>
                    ) : null}
                    {confirming ? (
                      <div
                        className="delivery-retry-confirm"
                        role="group"
                        aria-labelledby={`retry-title-${delivery.id}`}
                      >
                        <strong id={`retry-title-${delivery.id}`}>
                          {copy.retryTitle}
                        </strong>
                        <p>{copy.retryBody}</p>
                        <div>
                          <button
                            type="button"
                            disabled={retrying}
                            onClick={onCancelRetry}
                          >
                            {copy.cancel}
                          </button>
                          <button
                            className="danger"
                            type="button"
                            disabled={retrying}
                            onClick={() => onRetry(delivery.id)}
                          >
                            {retrying ? copy.retryingAction : copy.retryNow}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })
          )}
        </div>
      ) : null}
    </article>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortHash(value: string | undefined): string {
  return value ? value.slice(0, 12) : copy.hashMissing;
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${value} ms`;
  return `${Number((value / 1_000).toFixed(2))} s`;
}

function parsePreviewHeaders(
  input: string,
): Pick<PreviewInboundChannelAdapterRequest, "headers"> {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "{}") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(copy.previewHeadersInvalid);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(copy.previewHeadersInvalid);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") throw new Error(copy.previewHeadersInvalid);
    headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? { headers } : {};
}

function adapterSampleHeadersText(
  adapter: InboundChannelAdapterDescriptor | undefined,
): string {
  if (!adapter || Object.keys(adapter.sampleHeaders).length === 0) return "{}";
  return JSON.stringify(adapter.sampleHeaders, null, 2);
}

function adapterSampleBody(
  adapter: InboundChannelAdapterDescriptor | undefined,
): string {
  return adapter?.sampleBody ?? "{}";
}

function deadLetterQualificationSummary(artifact: InboundDeadLetterExport): {
  qualifiedCount: number;
  evidenceMissingCount: number;
  adapterCatalogDriftCount: number;
} {
  return {
    qualifiedCount:
      artifact.qualifiedCount ??
      artifact.deliveries.filter(
        (delivery) => delivery.qualificationStatus === "qualified",
      ).length,
    evidenceMissingCount:
      artifact.evidenceMissingCount ??
      artifact.deliveries.filter(
        (delivery) => delivery.qualificationStatus === "evidence_missing",
      ).length,
    adapterCatalogDriftCount:
      artifact.adapterCatalogDriftCount ??
      artifact.deliveries.filter(
        (delivery) => delivery.qualificationStatus === "adapter_catalog_drift",
      ).length,
  };
}

function downloadDeadLetterArtifact(artifact: InboundDeadLetterExport): void {
  const blob = new Blob([`${JSON.stringify(artifact, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `napier-dead-letters-${artifact.channel.id}-${artifact.contentSha256.slice(0, 12)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadDeadLetterRetryHistoryArtifact(
  history: InboundDeadLetterRetryHistory,
): void {
  const blob = new Blob([`${JSON.stringify(history, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `napier-dead-letter-retry-history-${history.channelId}-${history.contentSha256.slice(0, 12)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function deadLetterVerificationHash(
  verification: InboundDeadLetterExportVerification,
): string {
  return (
    verification.declaredContentSha256 ??
    verification.recomputedContentSha256 ??
    verification.contentSha256
  );
}

async function readJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text()) as unknown;
}

function errorMessage(error: unknown): string {
  return formatApiErrorMessage(error);
}
