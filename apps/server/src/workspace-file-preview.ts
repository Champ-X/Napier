import { stat } from "node:fs/promises";
import path from "node:path";

export interface WorkspaceFilePreview {
  path: string;
  filename: string;
  contentType: string;
  contents: Buffer;
  sizeBytes: number;
  sha256: string;
}

/** Conversation links prefer a retained Thread output; file-tree selections are absolute. */
export async function resolveThreadOutputFile(
  root: string,
  requested: string | undefined,
  threadId: string | undefined,
): Promise<string | undefined> {
  if (!threadId || !requested || path.isAbsolute(requested)) return requested;
  const relative = path.normalize(requested);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    relative.startsWith(`outputs${path.sep}`)
  )
    return requested;
  const scoped = path.join("outputs", threadId, relative);
  try {
    await stat(path.join(root, scoped));
    return scoped;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return requested;
  }
}
