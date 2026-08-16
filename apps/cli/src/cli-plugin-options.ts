import { requiredValue } from "./cli-option-values.js";

export const PLUGIN_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--scaffold",
  "--enable",
  "--disable",
  "--expected-preview",
  "--output",
  "--package",
  "--display-name",
]);
export const PLUGIN_FLAG_OPTIONS = new Set(["--apply"]);

export interface CliPluginScaffoldOptions {
  operation: "scaffold";
  workspace: string;
  pluginId: string;
  outputPath?: string;
  packageName?: string;
  displayName?: string;
  jsonl: boolean;
}

export interface CliPluginStateOptions {
  operation: "status" | "enable" | "disable";
  workspace: string;
  dataRoot?: string;
  pluginId?: string;
  expectedPreviewSha256?: string;
  apply: boolean;
  jsonl: boolean;
}

export interface CliPluginScaffoldAction {
  kind: "plugins";
  options: CliPluginScaffoldOptions | CliPluginStateOptions;
}

export function parsePluginOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): CliPluginScaffoldAction {
  const operation = pluginOperation(values);
  const apply = flags.has("--apply");
  const expectedPreviewSha256 = previewSha256(values);
  if (operation === "scaffold") {
    return scaffoldAction(values, apply, expectedPreviewSha256, jsonl);
  }
  return stateAction(values, operation, apply, expectedPreviewSha256, jsonl);
}

function pluginOperation(
  values: Map<string, string>,
): CliPluginScaffoldOptions["operation"] | CliPluginStateOptions["operation"] {
  const operations = [
    ...(values.has("--scaffold") ? ["scaffold" as const] : []),
    ...(values.has("--enable") ? ["enable" as const] : []),
    ...(values.has("--disable") ? ["disable" as const] : []),
  ];
  if (operations.length > 1) {
    throw new Error(
      "--scaffold, --enable, and --disable are mutually exclusive",
    );
  }
  return operations[0] ?? "status";
}

function previewSha256(values: Map<string, string>): string | undefined {
  const value = values.get("--expected-preview")?.trim();
  if (value !== undefined && !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("--expected-preview must be a lower-case SHA-256");
  }
  return value;
}

function scaffoldAction(
  values: Map<string, string>,
  apply: boolean,
  expectedPreviewSha256: string | undefined,
  jsonl: boolean,
): CliPluginScaffoldAction {
  if (apply || expectedPreviewSha256 || values.has("--data-root")) {
    throw new Error("Plugin scaffold does not accept state options");
  }
  return {
    kind: "plugins",
    options: {
      operation: "scaffold",
      workspace: requiredValue(values, "--workspace"),
      pluginId: requiredValue(values, "--scaffold"),
      jsonl,
      ...(values.has("--output")
        ? { outputPath: requiredValue(values, "--output") }
        : {}),
      ...(values.has("--package")
        ? { packageName: requiredValue(values, "--package") }
        : {}),
      ...(values.has("--display-name")
        ? { displayName: requiredValue(values, "--display-name") }
        : {}),
    },
  };
}

function stateAction(
  values: Map<string, string>,
  operation: CliPluginStateOptions["operation"],
  apply: boolean,
  expectedPreviewSha256: string | undefined,
  jsonl: boolean,
): CliPluginScaffoldAction {
  if (
    values.has("--output") ||
    values.has("--package") ||
    values.has("--display-name")
  ) {
    throw new Error("Plugin state operation does not accept scaffold options");
  }
  if (operation === "status" && (apply || expectedPreviewSha256)) {
    throw new Error("Plugin status does not accept apply options");
  }
  if (operation !== "status" && apply !== Boolean(expectedPreviewSha256)) {
    throw new Error(
      "Plugin state apply requires both --apply and --expected-preview",
    );
  }
  return {
    kind: "plugins",
    options: {
      operation,
      workspace: requiredValue(values, "--workspace"),
      apply,
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(operation === "enable" || operation === "disable"
        ? { pluginId: requiredValue(values, `--${operation}`) }
        : {}),
      ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
    },
  };
}
