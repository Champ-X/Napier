import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface LspProtocolPathBinding {
  workspaceRootUri: string;
  targetUri: string;
  toHostUri(uri: string): string | undefined;
}

export interface LspProtocolPathRequest {
  workspaceRoot: string;
  target: string;
  protocolWorkspaceRoot?: string;
}

export function createLspProtocolPathBinding(
  input: LspProtocolPathRequest,
): LspProtocolPathBinding {
  if (!input.protocolWorkspaceRoot) {
    return {
      workspaceRootUri: pathToFileURL(input.workspaceRoot).href,
      targetUri: pathToFileURL(input.target).href,
      toHostUri: (uri) => uri,
    };
  }
  if (input.protocolWorkspaceRoot !== "/workspace") {
    throw new Error("LSP protocol workspace root is invalid");
  }
  const relative = path.relative(input.workspaceRoot, input.target);
  if (!inside(relative, path)) {
    throw new Error("LSP protocol target path escapes the workspace");
  }
  const protocolTarget = path.posix.join(
    input.protocolWorkspaceRoot,
    ...relative.split(path.sep),
  );
  const workspaceRootUri = pathToFileURL(input.protocolWorkspaceRoot).href;
  const targetUri = pathToFileURL(protocolTarget).href;
  return {
    workspaceRootUri,
    targetUri,
    toHostUri: (uri) =>
      protocolUriToHost(uri, input.protocolWorkspaceRoot!, input.workspaceRoot),
  };
}

export function protocolTargetUri(request: LspProtocolPathRequest): string {
  return createLspProtocolPathBinding(request).targetUri;
}

export function protocolWorkspaceRootUri(
  request: LspProtocolPathRequest,
): string {
  return createLspProtocolPathBinding(request).workspaceRootUri;
}

function protocolUriToHost(
  uri: string,
  protocolWorkspaceRoot: string,
  workspaceRoot: string,
): string | undefined {
  let url: URL;
  let protocolPath: string;
  try {
    url = new URL(uri);
    if (
      url.protocol !== "file:" ||
      url.hostname !== "" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    protocolPath = path.posix.resolve(fileURLToPath(url));
  } catch {
    return undefined;
  }
  const relative = path.posix.relative(protocolWorkspaceRoot, protocolPath);
  if (!inside(relative, path.posix)) return undefined;
  return pathToFileURL(path.resolve(workspaceRoot, ...relative.split("/")))
    .href;
}

function inside(
  relative: string,
  pathApi: typeof path.posix | typeof path.win32,
): boolean {
  return (
    relative === "" ||
    (!relative.startsWith(`..${pathApi.sep}`) &&
      relative !== ".." &&
      !pathApi.isAbsolute(relative))
  );
}
