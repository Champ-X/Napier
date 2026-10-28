// Source inspection is streamed, so the source byte budget is independent of
// retained text. Writable text stays bounded by the transactional commit path.
export const SUBAGENT_WORKTREE_POLICY = Object.freeze({
  version: 1,
  maxFiles: 50_000,
  maxDirectories: 50_000,
  maxDepth: 64,
  maxSourceBytes: 512 * 1024 * 1024,
  maxSourceFileBytes: 16 * 1024 * 1024,
  maxWriteFiles: 32,
  maxWriteFileBytes: 1024 * 1024,
});
