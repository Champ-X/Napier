import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deliveryManager } from "./subagent-worktree-delivery-fixture.js";
import { commitWorkspaceChanges } from "../src/workspace-change-commit.js";
const config = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
  workspaceRoot: string;
  dataRoot: string;
  previewId: string;
  mode: string;
  output: string;
};
const manager = deliveryManager(config, {
  commitChanges: async (options) => {
    if (config.mode === "before_commit") process.kill(process.pid, "SIGKILL");
    const result = await commitWorkspaceChanges(options);
    await appendFile(
      path.join(config.dataRoot, "commits.log"),
      `${JSON.stringify({ status: result.status, count: result.committedFileCount })}\n`,
    );
    if (config.mode === "after_commit") process.kill(process.pid, "SIGKILL");
    return result;
  },
});
try {
  const result = await manager.apply(config.previewId);
  await writeFile(config.output, JSON.stringify({ result }));
} catch (error) {
  await writeFile(
    config.output,
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}
