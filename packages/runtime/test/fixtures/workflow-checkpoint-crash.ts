import { readFile } from "node:fs/promises";
import path from "node:path";
import { openWorkflowFixture } from "./workflow-approval-recovery-setup.js";

const [root, eventType] = process.argv.slice(2);
if (!root || !eventType) throw new Error("Crash fixture arguments required");
const fixture = await openWorkflowFixture(root);
const options = JSON.parse(
  await readFile(path.join(root, "checkpoint-request.json"), "utf8"),
);
await fixture.workflows.recover({
  ...options,
  onEvent(event) {
    if (event.type === eventType) process.kill(process.pid, "SIGKILL");
  },
});
throw new Error("Crash point was not reached");
