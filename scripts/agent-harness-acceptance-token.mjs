import { CredentialReferenceStore } from "../packages/runtime/dist/credentials.js";
import { AgentRuntime } from "../packages/runtime/dist/agent-runtime.js";
import { ModelRegistry } from "../packages/runtime/dist/models.js";
import {
  addLedgerRun,
  createEvidenceStore,
  ledgerRun,
  readinessSandbox,
  reopenEvidenceStore,
} from "./agent-harness-acceptance-evidence-support.mjs";

const TOKEN_EVENTS = new Set([
  "model.context.token_pressure",
  "model.context.token_calibration",
]);
const PROVIDER = "deepseek";
const MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
const OBSERVATIONS = 20;
const WARMUP_RUNS = 2;

export async function collectTokenEvidence(root, ledgerRuns) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is required for release acceptance token evidence",
    );
  }
  let fixture = await createEvidenceStore(root, "token-calibration");
  await fixture.store.createCredentialReference({
    providerId: PROVIDER,
    label: "Agent Harness acceptance live usage",
    source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
  });
  const credentials = new CredentialReferenceStore({
    store: fixture.store,
    env: { DEEPSEEK_API_KEY: apiKey },
  });
  const registry = new ModelRegistry(credentials);
  if (!(await registry.isConfigured({ provider: PROVIDER, id: MODEL }))) {
    throw new Error(`Primary model is not configured: ${PROVIDER}/${MODEL}`);
  }
  const agent = await fixture.store.updateAgent(
    fixture.store.listAgents()[0].id,
    {
      toolPolicy: "observe",
      enabledTools: [],
      enabledSkills: [],
      enabledSubagents: [],
      modelAdvisor: { mode: "off", enabledRules: [] },
    },
  );
  const runtime = new AgentRuntime(
    fixture.store,
    registry,
    undefined,
    readinessSandbox("agent-harness-live-token"),
  );
  const records = [];
  for (let index = 0; index < WARMUP_RUNS + OBSERVATIONS; index += 1) {
    const thread = await fixture.store.createThread({
      title: `Live token calibration ${String(index + 1)}`,
      agentId: agent.id,
    });
    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: `Reply with exactly NAPIER_TOKEN_OK_${String(index + 1)}.`,
      model: { provider: PROVIDER, id: MODEL },
    });
    if (run.status !== "completed") {
      throw new Error(
        `Live token calibration Run failed: ${run.id}/${run.error ?? "unknown"}`,
      );
    }
    if (index >= WARMUP_RUNS) {
      records.push({ threadId: thread.id, runId: run.id });
    }
  }
  fixture = await reopenEvidenceStore(fixture);
  try {
    const observations = [];
    let fallbackProbe;
    for (const [index, record] of records.entries()) {
      const events = (await fixture.store.listEvents(record.threadId)).filter(
        (event) => event.runId === record.runId,
      );
      const calibration = events.find(
        (event) =>
          event.type === "model.context.token_calibration" &&
          event.payload?.status === "calibrated" &&
          event.payload?.provider === PROVIDER &&
          event.payload?.model === MODEL,
      );
      if (!calibration) {
        throw new Error(
          `Usage-bound calibration event is unavailable: ${record.runId}`,
        );
      }
      const pressure = events.find(
        (event) =>
          event.type === "model.context.token_pressure" &&
          event.payload?.meterProviderId === "napier.conservative-heuristic" &&
          event.payload?.fallbackApplied === true,
      );
      const runEvidenceSha256 = addLedgerRun(
        ledgerRuns,
        await ledgerRun(
          fixture.store,
          record.threadId,
          record.runId,
          TOKEN_EVENTS,
        ),
      );
      observations.push({
        provider: PROVIDER,
        model: MODEL,
        contentClass: calibration.payload.contentClass,
        calibrationEventId: calibration.id,
        runEvidenceSha256,
      });
      if (!fallbackProbe && pressure) {
        fallbackProbe = { eventId: pressure.id, runEvidenceSha256 };
      }
      if (index === records.length - 1 && !fallbackProbe) {
        throw new Error("Conservative token fallback event is unavailable");
      }
    }
    return {
      primaryModels: [{ provider: PROVIDER, id: MODEL }],
      tokenCalibrationObservations: observations,
      conservativeTokenFallbackProbe: fallbackProbe,
    };
  } finally {
    await fixture.store.shutdown();
  }
}
