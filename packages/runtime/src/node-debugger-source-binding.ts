import {
  assertWorkspaceSourceCurrent,
  loadWorkspaceSourceFile,
  type WorkspaceSourceFile,
} from "./workspace-source.js";

const PROGRAM_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
]);
const SOURCE_MAP_SOURCE_EXTENSIONS = new Set([
  ...PROGRAM_EXTENSIONS,
  ".jsx",
  ".tsx",
]);
const SOURCE_MAP_EXTENSIONS = new Set([".map"]);

export interface NodeDebuggerSourceBinding {
  source: WorkspaceSourceFile;
  program: WorkspaceSourceFile;
  sourceMap?: WorkspaceSourceFile;
}

export async function loadNodeDebuggerSourceBinding(input: {
  workspaceRoot: string;
  path: string;
  programPath?: string;
  sourceMapPath?: string;
  maxBytes: number;
}): Promise<NodeDebuggerSourceBinding> {
  if (Boolean(input.programPath) !== Boolean(input.sourceMapPath)) {
    throw new Error(
      "Node debugger programPath and sourceMapPath must be provided together",
    );
  }
  const sourceMapped = Boolean(input.programPath && input.sourceMapPath);
  const source = await loadWorkspaceSourceFile(
    input.workspaceRoot,
    input.path,
    {
      label: "Node debugger",
      maxBytes: input.maxBytes,
      extensions: sourceMapped
        ? SOURCE_MAP_SOURCE_EXTENSIONS
        : PROGRAM_EXTENSIONS,
      extensionError:
        "Node debugger supports JavaScript, TypeScript, and source-mapped JSX/TSX source files",
    },
  );
  const program = sourceMapped
    ? await loadWorkspaceSourceFile(input.workspaceRoot, input.programPath!, {
        label: "Node debugger program",
        maxBytes: input.maxBytes,
        extensions: PROGRAM_EXTENSIONS,
        extensionError:
          "Node debugger source-map programs must be JavaScript or Node-executable TypeScript files",
      })
    : source;
  const sourceMap = sourceMapped
    ? await loadWorkspaceSourceFile(input.workspaceRoot, input.sourceMapPath!, {
        label: "Node debugger source map",
        maxBytes: input.maxBytes,
        extensions: SOURCE_MAP_EXTENSIONS,
        extensionError: "Node debugger source maps must use the .map extension",
      })
    : undefined;
  if (
    sourceMapped &&
    (source.target === program.target ||
      source.target === sourceMap?.target ||
      program.target === sourceMap?.target)
  ) {
    throw new Error(
      "Node debugger source, program, and source map must be distinct files",
    );
  }
  return {
    source,
    program,
    ...(sourceMap ? { sourceMap } : {}),
  };
}

export async function assertNodeDebuggerSourceBindingCurrent(
  binding: NodeDebuggerSourceBinding,
  maxBytes: number,
): Promise<void> {
  await assertWorkspaceSourceCurrent(binding.source, {
    label: "Node debugger",
    maxBytes,
  });
  if (binding.program !== binding.source) {
    await assertWorkspaceSourceCurrent(binding.program, {
      label: "Node debugger program",
      maxBytes,
      changedMessage: "Node debugger program changed during execution",
    });
  }
  if (binding.sourceMap) {
    await assertWorkspaceSourceCurrent(binding.sourceMap, {
      label: "Node debugger source map",
      maxBytes,
      changedMessage: "Node debugger source map changed during execution",
    });
  }
}
