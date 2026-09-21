/** Host atomic replacement can leave stale dentries in a shared OCI mount.
 * Enumerate the observed workspace directories inside the container before
 * launching its verifier. This refreshes visibility without rewriting files or
 * weakening atomic edits. Exclusions match the verification workspace digest;
 * installed dependencies and linked trees are not synchronized by this pass.
 * The enclosing sandbox timeout and cancellation cover traversal and verifier. */
const CONTAINER_VERIFICATION_ENTRY = `
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.argv[1];
const pending = [root];
const deadline = performance.now() + 30000;
let entries = 0;
try {
  while (pending.length) {
    if (performance.now() >= deadline) throw Error('workspace visibility scan timed out');
    const directory = pending.pop();
    if (!fs.lstatSync(directory).isDirectory()) throw Error('workspace directory changed');
    const handle = fs.opendirSync(directory);
    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        if (performance.now() >= deadline) throw Error('workspace visibility scan timed out');
        if (['.git', '.napier', 'node_modules'].includes(entry.name)) continue;
        if (++entries > 100000) throw Error('workspace visibility scan exceeded entry limit');
        if (entry.isDirectory()) pending.push(path.join(directory, entry.name));
      }
    } finally { handle.closeSync(); }
  }
  const child = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.signal) process.kill(process.pid, child.signal);
  else process.exitCode = child.status ?? 1;
} catch (error) {
  console.error('OCI verification launch failed: ' + error.message);
  process.exitCode = 1;
}
`;

export function containerVerificationArgs(
  sandboxId: string,
  workspaceRoot: string,
  args: string[],
): string[] {
  return sandboxId === "oci-container"
    ? ["--eval", CONTAINER_VERIFICATION_ENTRY, "--", workspaceRoot, ...args]
    : args;
}
