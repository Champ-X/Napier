import manifestValue from "../napier.plugin.json" with { type: "json" };

import {
  KERNEL_AGENT_RUNTIME,
  KERNEL_PROJECTION_REGISTRY,
  createKernelServiceKey,
  validateKernelPluginManifest,
  type KernelPluginDefinition,
  type KernelProjectionDefinition,
  type KernelProjectionRegistry,
} from "@napier/runtime";

const manifest = validateKernelPluginManifest(manifestValue);
const projection: KernelProjectionDefinition<
  undefined,
  { eventCount: number; lastEventType?: string },
  { eventCount: number; lastEventType?: string }
> = {
  id: "status.example.status",
  version: 1,
  init: () => ({ eventCount: 0 }),
  apply: (_state, event) => ({
    eventCount: event.seq,
    lastEventType: event.type,
  }),
  view: (state) => ({ ...state }),
};
const serviceKey = createKernelServiceKey<ExampleProjectionService>(
  "plugin.status-example.projection",
);

class ExampleProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): {
        id: string;
        createdAt: string;
        eventCount: number;
      };
      listEvents(
        threadId: string,
        afterSeq?: number,
      ): Promise<import("@napier/contracts").RunEvent[]>;
    },
  ) {
    registry.register(projection, manifest.id);
  }

  project(threadId: string) {
    const thread = this.store.getThread(threadId);
    return this.registry.project({
      definition: projection,
      subjectId: threadId,
      seed: undefined,
      sourceIdentity: { id: thread.id, createdAt: thread.createdAt },
      sourceWatermark: thread.eventCount,
      loadEvents: (afterSeq) => this.store.listEvents(threadId, afterSeq),
    });
  }

  dispose() {
    this.registry.disposeOwner(manifest.id);
  }
}

export const plugin = {
  manifest,
  setup(scope) {
    scope.register({
      key: serviceKey,
      dependencies: [KERNEL_PROJECTION_REGISTRY, KERNEL_AGENT_RUNTIME],
      create: (resolver) =>
        new ExampleProjectionService(
          resolver.require(KERNEL_PROJECTION_REGISTRY),
          resolver.require(KERNEL_AGENT_RUNTIME).store,
        ),
      dispose: (service) => service.dispose(),
    });
  },
} satisfies KernelPluginDefinition;

export default plugin;
