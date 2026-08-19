import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";

import type { KernelHookHandler, KernelHookName } from "./kernel-hooks.js";
import {
  validateKernelPluginManifest,
  type KernelPluginManifest,
} from "./kernel-plugin-manifest.js";
import type { KernelServiceRegistration } from "./kernel-service-registry.js";
import type { AgentModelCallExtension } from "./kernel-model-call-pipeline.js";

export interface KernelPluginScope {
  register<T>(registration: KernelServiceRegistration<T>): void;
  on<Name extends KernelHookName>(
    name: Name,
    handler: KernelHookHandler<Name>,
  ): () => void;
  interceptModelCall(extension: AgentModelCallExtension): () => void;
  resolve(): Promise<void>;
  dispose(): Promise<void>;
}

export interface KernelPluginDefinition {
  manifest: KernelPluginManifest;
  setup(scope: KernelPluginScope): void | Promise<void>;
}

interface InstalledPlugin {
  definition: KernelPluginDefinition;
  scope?: KernelPluginScope;
}

export class KernelPluginRegistry {
  private readonly plugins = new Map<string, InstalledPlugin>();
  private closed = false;

  constructor(
    private readonly createScope: (owner: string) => KernelPluginScope,
  ) {}

  install(definition: KernelPluginDefinition): KernelPluginInspection {
    this.assertOpen();
    const manifest = validateKernelPluginManifest(definition.manifest);
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Kernel plugin is already installed: ${manifest.id}`);
    }
    this.plugins.set(manifest.id, {
      definition: { manifest, setup: definition.setup },
    });
    return this.inspectOne(manifest.id);
  }

  async enable(id: string): Promise<KernelPluginInspection> {
    this.assertOpen();
    const plugin = this.require(id);
    if (plugin.scope) return this.inspectOne(id);
    this.assertDependencies(plugin.definition.manifest);
    const scope = this.createScope(id);
    try {
      await plugin.definition.setup(scope);
      await scope.resolve();
      plugin.scope = scope;
      return this.inspectOne(id);
    } catch (error) {
      await scope.dispose().catch(() => undefined);
      throw error;
    }
  }

  async disable(id: string): Promise<KernelPluginInspection> {
    this.assertOpen();
    const plugin = this.require(id);
    const dependent = [...this.plugins.values()].find(
      (candidate) =>
        candidate.scope &&
        candidate.definition.manifest.dependencies.some(
          (dependency) => dependency.id === id,
        ),
    );
    if (dependent) {
      throw new Error(
        `Kernel plugin ${id} is required by enabled plugin ${dependent.definition.manifest.id}`,
      );
    }
    await plugin.scope?.dispose();
    delete plugin.scope;
    return this.inspectOne(id);
  }

  async uninstall(id: string): Promise<void> {
    this.assertOpen();
    await this.disable(id);
    const dependent = [...this.plugins.values()].find((candidate) =>
      candidate.definition.manifest.dependencies.some(
        (dependency) => dependency.id === id,
      ),
    );
    if (dependent) {
      throw new Error(
        `Kernel plugin ${id} is required by installed plugin ${dependent.definition.manifest.id}`,
      );
    }
    this.plugins.delete(id);
  }

  inspect(): KernelPluginInspection[] {
    return [...this.plugins.keys()].sort().map((id) => this.inspectOne(id));
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    const failures: unknown[] = [];
    for (const id of this.disableOrder()) {
      try {
        const plugin = this.plugins.get(id);
        await plugin?.scope?.dispose();
        if (plugin) delete plugin.scope;
      } catch (error) {
        failures.push(error);
      }
    }
    this.plugins.clear();
    this.closed = true;
    if (failures.length > 0) throw failures[0];
  }

  private assertDependencies(manifest: KernelPluginManifest): void {
    for (const dependency of manifest.dependencies) {
      const installed = this.plugins.get(dependency.id);
      if (!installed?.scope) {
        throw new Error(
          `Kernel plugin dependency is not enabled: ${manifest.id} requires ${dependency.id}`,
        );
      }
      if (
        !satisfiesVersion(
          installed.definition.manifest.version,
          dependency.versionRange,
        )
      ) {
        throw new Error(
          `Kernel plugin dependency version is incompatible: ${manifest.id} requires ${dependency.id} ${dependency.versionRange}`,
        );
      }
    }
  }

  private inspectOne(id: string): KernelPluginInspection {
    const plugin = this.require(id);
    const manifest = plugin.definition.manifest;
    return {
      id: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName,
      description: manifest.description,
      status: plugin.scope ? "enabled" : "disabled",
      trust: manifest.trust,
      dependencies: structuredClone(manifest.dependencies),
      capabilities: [...manifest.capabilities],
      permissions: [...manifest.permissions],
      hostEntry: entryLabel(manifest.entries.host),
      ...(manifest.entries.client
        ? { clientEntry: entryLabel(manifest.entries.client) }
        : {}),
      contributions: structuredClone(manifest.contributions),
      contentSha256: manifest.contentSha256,
    };
  }

  private disableOrder(): string[] {
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const candidate of this.plugins.values()) {
        if (
          candidate.definition.manifest.dependencies.some(
            (dependency) => dependency.id === id,
          )
        ) {
          visit(candidate.definition.manifest.id);
        }
      }
      ordered.push(id);
    };
    for (const id of this.plugins.keys()) visit(id);
    return ordered;
  }

  private require(id: string): InstalledPlugin {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Kernel plugin is not installed: ${id}`);
    return plugin;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Kernel plugin registry is closed");
  }
}

function entryLabel(entry: KernelPluginManifest["entries"]["host"]): string {
  return `${entry.package}${entry.export === "." ? "" : entry.export.slice(1)}`;
}

function satisfiesVersion(version: string, range: string): boolean {
  const current = semver(version);
  if (!current) return false;
  if (range === "*") return true;
  if (range.startsWith("^") || range.startsWith("~")) {
    const minimum = semver(range.slice(1));
    if (!minimum || compare(current, minimum) < 0) return false;
    const maximum = rangeUpperBound(range[0] as "^" | "~", minimum);
    return compare(current, maximum) < 0;
  }
  const exact = semver(range);
  if (exact) return compare(current, exact) === 0;
  return range.split(" ").every((part) => {
    const match = /^(>=|<=|>|<|=)(.+)$/u.exec(part);
    const target = match ? semver(match[2]!) : undefined;
    if (!match || !target) return false;
    const difference = compare(current, target);
    if (match[1] === ">=") return difference >= 0;
    if (match[1] === "<=") return difference <= 0;
    if (match[1] === ">") return difference > 0;
    if (match[1] === "<") return difference < 0;
    return difference === 0;
  });
}

function semver(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function rangeUpperBound(
  operator: "^" | "~",
  minimum: [number, number, number],
): [number, number, number] {
  if (operator === "~") return [minimum[0], minimum[1] + 1, 0];
  if (minimum[0] > 0) return [minimum[0] + 1, 0, 0];
  if (minimum[1] > 0) return [0, minimum[1] + 1, 0];
  return [0, 0, minimum[2] + 1];
}

function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}
