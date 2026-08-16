import path from "node:path";

import { scaffoldKernelPlugin } from "@napier/runtime/kernel-plugin-scaffold";
import {
  applyKernelPluginState,
  isBuiltinKernelPluginId,
  loadKernelPluginDesiredState,
  previewKernelPluginState,
} from "@napier/runtime/kernel-plugin-state";

import type {
  CliPluginScaffoldOptions,
  CliPluginStateOptions,
} from "./cli-plugin-options.js";
import type { CliIo } from "./cli-runtime.js";
import { errorMessage } from "./cli-text.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import { canonicalWorkspace } from "./workspace-path.js";

export async function executePluginScaffold(
  options: CliPluginScaffoldOptions | CliPluginStateOptions,
  io: CliIo,
): Promise<number> {
  if (options.operation !== "scaffold") {
    return executePluginState(options, io);
  }
  try {
    const receipt = await scaffoldKernelPlugin({
      workspaceRoot: path.resolve(io.cwd, options.workspace),
      id: options.pluginId,
      ...(options.outputPath ? { outputPath: options.outputPath } : {}),
      ...(options.packageName ? { packageName: options.packageName } : {}),
      ...(options.displayName ? { displayName: options.displayName } : {}),
    });
    if (options.jsonl) {
      await writeJsonLine(io.stdout, receipt);
    } else {
      await writeLine(io.stdout, receipt.outputPath);
      await writeLine(
        io.stderr,
        `Napier scaffolded ${receipt.pluginId}@${receipt.version} (${receipt.manifestSha256.slice(0, 12)})`,
      );
    }
    return 0;
  } catch (error) {
    if (options.jsonl) {
      await writeJsonLine(io.stdout, {
        type: "error",
        code: "plugin_scaffold_failed",
        message: errorMessage(error),
      });
    } else {
      await writeLine(
        io.stderr,
        `Napier plugin scaffold failed: ${errorMessage(error)}`,
      );
    }
    return 1;
  }
}

async function executePluginState(
  options: CliPluginStateOptions,
  io: CliIo,
): Promise<number> {
  try {
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    const dataRoot = path.resolve(
      io.cwd,
      options.dataRoot ?? path.join(workspaceRoot, ".napier"),
    );
    if (options.operation === "status") {
      const snapshot = await loadKernelPluginDesiredState(dataRoot);
      await output(io, options.jsonl, snapshot);
      return 0;
    }
    if (!options.pluginId || !isBuiltinKernelPluginId(options.pluginId)) {
      throw new Error(
        "Kernel plugin state supports plugin.browser or plugin.search",
      );
    }
    if (options.pluginId === "plugin.artifact") {
      throw new Error("Kernel Artifact plugin is boot-required");
    }
    const enabled = options.operation === "enable";
    if (!options.apply) {
      const preview = await previewKernelPluginState(
        dataRoot,
        options.pluginId,
        enabled,
      );
      await output(io, options.jsonl, preview);
      return 0;
    }
    const applied = await applyKernelPluginState({
      dataRoot,
      pluginId: options.pluginId,
      enabled,
      expectedPreviewSha256: options.expectedPreviewSha256!,
    });
    await output(io, options.jsonl, applied);
    return 0;
  } catch (error) {
    if (options.jsonl) {
      await writeJsonLine(io.stdout, {
        type: "error",
        code: "plugin_state_failed",
        message: errorMessage(error),
      });
    } else {
      await writeLine(
        io.stderr,
        `Napier plugin state failed: ${errorMessage(error)}`,
      );
    }
    return 1;
  }
}

async function output(
  io: CliIo,
  jsonl: boolean,
  value: unknown,
): Promise<void> {
  if (jsonl) {
    await writeJsonLine(io.stdout, value);
  } else {
    await writeLine(io.stdout, JSON.stringify(value, null, 2));
  }
}
