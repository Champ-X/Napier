import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { type AgentKernel } from "@napier/runtime/agent";
import {
  builtinUsagePriceTableCatalog,
  type ModelRegistry,
} from "@napier/runtime/model";
import { type LocalStore } from "@napier/runtime/store";
import { inspectStandardSkillCatalog } from "@napier/runtime/standard-skill-catalog";
import type { Context } from "hono";
import { Hono } from "hono";

import { BUNDLED_SKILLS } from "./bundled-skills.js";
import {
  setBodyContentSha256Header,
  jsonByteLength,
} from "./http-response-evidence.js";
import { attachKernelThreadProjections } from "./kernel-thread-projections.js";
import {
  inboundChannelAdapterCatalog,
  inboundChannelAdapterIdsSha256,
  inboundChannelAdapterCatalogSha256,
} from "./inbound-channel-adapter-catalog.js";
import {
  inboundChannelListSha256,
  setInboundChannelCountHeaders,
} from "./inbound-channel-admin-http-response.js";
import {
  automationScheduleListSha256,
  setAutomationScheduleCountHeaders,
} from "./schedule-http.js";

type BootstrapStore = Pick<
  LocalStore,
  | "getWorkspaceSummary"
  | "listAgents"
  | "listThreads"
  | "listMemories"
  | "listExtensions"
  | "listExtensionPublisherTrustAnchors"
  | "listExtensionPackageRolloutChannels"
  | "listSkillPackageInstallations"
  | "listCredentialReferences"
  | "listSchedules"
  | "listInboundChannels"
  | "listAgentRevisions"
  | "getDetail"
> &
  Partial<Pick<LocalStore, "listVisibleThreads" | "workspaceRoot">>;

type BootstrapServices = {
  store: BootstrapStore;
  models: ModelRegistry;
  kernel?: {
    threadSummaries: Pick<AgentKernel["threadSummaries"], "listVisible">;
    taskNarratives: Pick<AgentKernel["taskNarratives"], "project">;
    activePlans: Pick<AgentKernel["activePlans"], "project">;
    conversationActivityCandidates: Pick<
      AgentKernel["conversationActivityCandidates"],
      "project"
    >;
    conversationMessages: Pick<AgentKernel["conversationMessages"], "project">;
    conversationPlans: Pick<AgentKernel["conversationPlans"], "project">;
    conversationArtifacts: Pick<
      AgentKernel["conversationArtifacts"],
      "project"
    >;
    conversationActivityEvents: Pick<
      AgentKernel["conversationActivityEvents"],
      "project"
    >;
    conversationCitations: Pick<
      AgentKernel["conversationCitations"],
      "project"
    >;
    conversationRecoveries: Pick<
      AgentKernel["conversationRecoveries"],
      "project"
    >;
    conversationSubagents: Pick<
      AgentKernel["conversationSubagents"],
      "project" | "projectHub"
    >;
    operatorDecisions: Pick<AgentKernel["operatorDecisions"], "project">;
    plugins?: Pick<AgentKernel["plugins"], "inspect">;
  };
  subagentHubControls?: Pick<
    import("@napier/runtime/subagents").SubagentHubControlService,
    "availability"
  >;
  skillUserHome?: string;
};

export function registerBootstrapHttp(
  app: Hono,
  services: BootstrapServices,
): void {
  app.get("/api/bootstrap", async (context) => {
    const response = await createBootstrapResponse(
      services,
      context.req.query("thread"),
    );
    setBootstrapProjectionHeaders(context, response);
    return context.json(response);
  });
}

async function createBootstrapResponse(
  services: BootstrapServices,
  requestedThreadId?: string,
): Promise<LiveReadyBootstrapResponse> {
  const threads = services.kernel
    ? await services.kernel.threadSummaries.listVisible()
    : (services.store.listVisibleThreads?.() ?? services.store.listThreads());
  const activeThreadId = requestedThreadId ?? threads[0]?.id;
  const activeThread = activeThreadId
    ? await services.store.getDetail(activeThreadId, {
        kernelProjections: false,
      })
    : undefined;
  if (activeThread && services.kernel) {
    await attachKernelThreadProjections(
      activeThread,
      services.kernel,
      services.subagentHubControls,
    );
  }
  const agents = services.store.listAgents();
  const credentials = services.store.listCredentialReferences();
  const models = await services.models.list();
  const recommendedAgent =
    activeThread?.agent ??
    agents.find((agent) => agent.id === "agent_napier") ??
    agents[0];
  const recommendedRunModel = recommendedAgent
    ? await services.models.recommendDefaultRunModel(
        recommendedAgent,
        credentials,
        services.store.listAgentRevisions(recommendedAgent.id),
      )
    : { provider: "napier", id: "demo" };
  return {
    apiVersion: "2026-07-25",
    workspace: services.store.getWorkspaceSummary(),
    recommendedRunModel,
    agents,
    threads,
    skills: await bootstrapSkills(services),
    models,
    memories: services.store.listMemories(),
    extensions: services.store.listExtensions(),
    ...(services.kernel?.plugins
      ? { plugins: services.kernel.plugins.inspect() }
      : {}),
    extensionPublisherTrustAnchors:
      services.store.listExtensionPublisherTrustAnchors(),
    extensionPackageRolloutChannels:
      services.store.listExtensionPackageRolloutChannels(),
    skillPackageInstallations: services.store.listSkillPackageInstallations(),
    credentials,
    usagePriceTableCatalog: builtinUsagePriceTableCatalog(),
    schedules: services.store.listSchedules(),
    channels: services.store.listInboundChannels(),
    inboundChannelAdapters: inboundChannelAdapterCatalog(),
    inboundChannelAdapterCatalogSha256: inboundChannelAdapterCatalogSha256(),
    ...(activeThread ? { activeThread } : {}),
  };
}

async function bootstrapSkills(services: {
  store: BootstrapStore;
  skillUserHome?: string;
}) {
  const workspaceRoot = services.store.workspaceRoot;
  if (!workspaceRoot) return unavailableBundledSkills("workspace unavailable");
  try {
    return await inspectStandardSkillCatalog(workspaceRoot, {
      ...(services.skillUserHome ? { userHome: services.skillUserHome } : {}),
    });
  } catch (error) {
    const diagnostic =
      error instanceof Error && error.message
        ? error.message.slice(0, 160)
        : "catalog inspection failed";
    return unavailableBundledSkills(diagnostic);
  }
}

function unavailableBundledSkills(diagnostic: string) {
  return BUNDLED_SKILLS.map((skill) => ({
    ...skill,
    description: `Unavailable (${diagnostic}): ${skill.description}`,
    enabled: false,
  }));
}

function setBootstrapProjectionHeaders(
  context: Context,
  response: LiveReadyBootstrapResponse,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, response);
  context.header("X-Napier-Bootstrap-Bytes", String(jsonByteLength(response)));
  if (response.activeThread) {
    context.header(
      "X-Napier-Bootstrap-Active-Thread-Bytes",
      String(jsonByteLength(response.activeThread)),
    );
    context.header(
      "X-Napier-Bootstrap-Active-Thread-Event-Bytes",
      String(jsonByteLength(response.activeThread.events)),
    );
  }
  context.header(
    "X-Napier-Schedule-List-SHA256",
    automationScheduleListSha256(response.schedules),
  );
  setAutomationScheduleCountHeaders(context, response.schedules);
  context.header(
    "X-Napier-Channel-List-SHA256",
    inboundChannelListSha256(response.channels),
  );
  setInboundChannelCountHeaders(context, response.channels);
  context.header(
    "X-Napier-Adapter-Catalog-SHA256",
    response.inboundChannelAdapterCatalogSha256,
  );
  context.header(
    "X-Napier-Adapter-Count",
    String(response.inboundChannelAdapters.length),
  );
  context.header(
    "X-Napier-Adapter-Ids-SHA256",
    inboundChannelAdapterIdsSha256(response.inboundChannelAdapters),
  );
}
