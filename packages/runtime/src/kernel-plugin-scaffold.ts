import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { Readable } from "node:stream";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createKernelPluginManifest } from "./kernel-plugin-manifest.js";
import {
  createMissingDirectories,
  inspectMissingPath,
  normalizeMutationPath,
} from "./workspace-file-scope.js";
import { writeWorkspaceOutputFile } from "./workspace-output-file.js";

export interface KernelPluginScaffoldRequest {
  workspaceRoot: string;
  id: string;
  outputPath?: string;
  packageName?: string;
  displayName?: string;
}

export interface KernelPluginScaffoldReceipt {
  kind: "napier.kernel-plugin-scaffold";
  schemaVersion: 1;
  pluginId: string;
  version: "0.1.0";
  packageName: string;
  outputPath: string;
  manifestSha256: string;
  fileCount: number;
  fileSetSha256: string;
  contentSha256: string;
}

export async function scaffoldKernelPlugin(
  request: KernelPluginScaffoldRequest,
): Promise<KernelPluginScaffoldReceipt> {
  const workspaceRoot = await realpath(path.resolve(request.workspaceRoot));
  const slug = pluginSlug(request.id);
  const outputPath = normalizeMutationPath(
    request.outputPath ?? path.join("plugins", slug),
  );
  const packageName = request.packageName ?? `@napier/plugin-${slug}`;
  const displayName = request.displayName ?? displayNameFor(slug);
  const projectionId = `${slug.replaceAll("-", ".")}.status`;
  const manifest = createKernelPluginManifest({
    id: request.id,
    version: "0.1.0",
    displayName,
    description: `Example first-party ${displayName} projection plugin.`,
    trust: "first_party",
    dependencies: [],
    capabilities: ["projection"],
    permissions: [],
    entries: {
      host: { package: packageName, export: "./host" },
    },
    contributions: {
      tools: [],
      providers: [],
      prompts: [],
      projections: [projectionId],
      uiSlots: [],
    },
  });
  const target = await inspectMissingPath(workspaceRoot, outputPath, true);
  const files = scaffoldFiles({
    packageName,
    pluginId: manifest.id,
    projectionId,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
  });
  const createdDirectories = await createMissingDirectories(
    target.missingDirectories,
  );
  try {
    await mkdir(path.join(target.target, "src"), { mode: 0o755 });
    for (const [relativePath, contents] of files) {
      await writeWorkspaceOutputFile(
        workspaceRoot,
        path.join(outputPath, relativePath),
        Readable.from([contents]),
        {
          scope: "Kernel plugin scaffold",
          action: "write",
          maximumBytes: 256 * 1024,
        },
      );
    }
  } catch (error) {
    await rm(target.target, { recursive: true, force: true });
    throw error;
  }
  const fileSet = [...files]
    .map(([relativePath, contents]) => ({
      path: relativePath,
      sha256: sha256(contents),
      bytes: Buffer.byteLength(contents),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const content = {
    kind: "napier.kernel-plugin-scaffold" as const,
    schemaVersion: 1 as const,
    pluginId: manifest.id,
    version: "0.1.0" as const,
    packageName,
    outputPath,
    manifestSha256: manifest.contentSha256,
    fileCount: fileSet.length,
    fileSetSha256: sha256(canonicalJson(fileSet)),
  };
  void createdDirectories;
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function scaffoldFiles(input: {
  packageName: string;
  pluginId: string;
  projectionId: string;
  manifestJson: string;
}): Map<string, string> {
  return new Map([
    ["napier.plugin.json", input.manifestJson],
    ["package.json", packageJson(input.packageName)],
    ["tsconfig.json", tsconfigJson()],
    ["src/host.ts", hostSource(input.pluginId, input.projectionId)],
    ["README.md", readme(input.packageName, input.pluginId)],
  ]);
}

function packageJson(packageName: string): string {
  return `${JSON.stringify(
    {
      name: packageName,
      version: "0.1.0",
      private: true,
      type: "module",
      exports: {
        "./host": {
          types: "./dist/host.d.ts",
          import: "./dist/host.js",
        },
      },
      scripts: { build: "tsc -p tsconfig.json" },
      dependencies: {
        "@napier/contracts": "*",
        "@napier/runtime": "*",
      },
      devDependencies: { typescript: "^5.9.3" },
    },
    null,
    2,
  )}\n`;
}

function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        declaration: true,
        declarationMap: true,
        outDir: "dist",
        rootDir: "src",
        resolveJsonModule: true,
        skipLibCheck: true,
        verbatimModuleSyntax: true,
      },
      include: ["src/**/*.ts", "napier.plugin.json"],
    },
    null,
    2,
  )}\n`;
}

function hostSource(pluginId: string, projectionId: string): string {
  return `import manifestValue from "../napier.plugin.json" with { type: "json" };

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
  id: ${JSON.stringify(projectionId)},
  version: 1,
  init: () => ({ eventCount: 0 }),
  apply: (_state, event) => ({
    eventCount: event.seq,
    lastEventType: event.type,
  }),
  view: (state) => ({ ...state }),
};
const serviceKey = createKernelServiceKey<ExampleProjectionService>(
  ${JSON.stringify(`${pluginId}.projection`)},
);

class ExampleProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): { id: string; createdAt: string; eventCount: number };
      listEvents(threadId: string, afterSeq?: number): Promise<import("@napier/contracts").RunEvent[]>;
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
`;
}

function readme(packageName: string, pluginId: string): string {
  return `# ${pluginId}

Minimal first-party Napier Kernel plugin generated by \`napier plugins --scaffold\`.

## Build

\`\`\`sh
npm install
npm run build
\`\`\`

## Lifecycle

\`\`\`ts
import plugin from "${packageName}/host";

kernel.plugins.install(plugin);
await kernel.plugins.enable(plugin.manifest.id);
kernel.plugins.inspect();
await kernel.plugins.disable(plugin.manifest.id);
await kernel.plugins.uninstall(plugin.manifest.id);
\`\`\`

This in-process path is for reviewed first-party code. Keep untrusted external
capabilities on Napier's signed MCP package, approval, and sandbox boundary.
`;
}

function pluginSlug(id: string): string {
  if (!/^plugin\.[a-z][a-z0-9.-]{1,71}$/u.test(id)) {
    throw new Error("Kernel plugin scaffold ID must match plugin.<name>");
  }
  return id.slice("plugin.".length).replaceAll(".", "-");
}

function displayNameFor(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
