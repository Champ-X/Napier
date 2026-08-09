import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import {
  builtinUsagePriceTableCatalog,
  type LocalStore,
  type ModelRegistry,
} from "@napier/runtime";
import { inspectStandardSkillCatalog } from "@napier/runtime/standard-skill-catalog";
import type { Context } from "hono";
import { Hono } from "hono";

import { BUNDLED_SKILLS } from "./bundled-skills.js";
import {
  setBodyContentSha256Header,
  jsonByteLength,
} from "./http-response-evidence.js";
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

export function registerBootstrapHttp(
  app: Hono,
  services: {
    store: BootstrapStore;
    models: ModelRegistry;
    skillUserHome?: string;
  },
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
  services: {
    store: BootstrapStore;
    models: ModelRegistry;
    skillUserHome?: string;
  },
  requestedThreadId?: string,
): Promise<LiveReadyBootstrapResponse> {
  const threads =
    services.store.listVisibleThreads?.() ?? services.store.listThreads();
  const activeThreadId = requestedThreadId ?? threads[0]?.id;
  const activeThread = activeThreadId
    ? await services.store.getDetail(activeThreadId)
    : undefined;
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
  if (!workspaceRoot) return BUNDLED_SKILLS;
  const discovered = await inspectStandardSkillCatalog(workspaceRoot, {
    ...(services.skillUserHome ? { userHome: services.skillUserHome } : {}),
  }).catch(() => []);
  const catalog = new Map(BUNDLED_SKILLS.map((skill) => [skill.name, skill]));
  for (const skill of discovered) catalog.set(skill.name, skill);
  return [...catalog.values()].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
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
