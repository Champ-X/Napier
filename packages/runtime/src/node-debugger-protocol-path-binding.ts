import path from "node:path";

import type { NodeDebuggerSourceBinding } from "./node-debugger-source-binding.js";

export interface NodeDebuggerProtocolSourceBinding {
  workspaceRoot: string;
  sourceTarget: string;
  programTarget: string;
  sourceMapTarget?: string;
}

export function nodeDebuggerLaunchArguments(input: {
  binding: NodeDebuggerSourceBinding;
  protocol: NodeDebuggerProtocolSourceBinding;
  args: string[];
}): Record<string, unknown> {
  const { source, program, sourceMap } = input.binding;
  return {
    program: input.protocol.programTarget,
    workspaceRoot: input.protocol.workspaceRoot,
    sourceTarget: input.protocol.sourceTarget,
    sourcePath: source.path,
    sourceSha256: source.fileSha256,
    programPath: program.path,
    programSha256: program.fileSha256,
    ...(sourceMap
      ? {
          sourceMapTarget: input.protocol.sourceMapTarget,
          sourceMapPath: sourceMap.path,
          sourceMapSha256: sourceMap.fileSha256,
        }
      : {}),
    args: input.args,
  };
}

export function createNodeDebuggerProtocolSourceBinding(
  binding: NodeDebuggerSourceBinding,
  protocolWorkspaceRoot?: string,
): NodeDebuggerProtocolSourceBinding {
  if (!protocolWorkspaceRoot) {
    return {
      workspaceRoot: binding.source.workspaceRoot,
      sourceTarget: binding.source.target,
      programTarget: binding.program.target,
      ...(binding.sourceMap
        ? { sourceMapTarget: binding.sourceMap.target }
        : {}),
    };
  }
  if (protocolWorkspaceRoot !== "/workspace") {
    throw new Error("Node debugger protocol workspace root is invalid");
  }
  return {
    workspaceRoot: protocolWorkspaceRoot,
    sourceTarget: protocolPath(binding.source, protocolWorkspaceRoot),
    programTarget: protocolPath(binding.program, protocolWorkspaceRoot),
    ...(binding.sourceMap
      ? {
          sourceMapTarget: protocolPath(
            binding.sourceMap,
            protocolWorkspaceRoot,
          ),
        }
      : {}),
  };
}

function protocolPath(
  source: { workspaceRoot: string; target: string },
  protocolWorkspaceRoot: string,
): string {
  const relative = path.relative(source.workspaceRoot, source.target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Node debugger protocol source escapes the workspace");
  }
  return path.posix.join(protocolWorkspaceRoot, ...relative.split(path.sep));
}
