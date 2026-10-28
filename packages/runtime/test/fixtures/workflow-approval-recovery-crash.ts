import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { SqliteLedger } from "../../src/sqlite-ledger.js";
import {
  createApprovalFixture,
  openWorkflowFixture,
} from "./workflow-approval-recovery-setup.js";

const [root, checkpoint = "after-answer", selection] = process.argv.slice(2);
if (!root) throw new Error("Fixture root required");
if (checkpoint === "retry" || checkpoint === "hold-continuation") {
  const fixture = await openWorkflowFixture(root);
  const request = JSON.parse(
    await readFile(path.join(root, "request.json"), "utf8"),
  );
  if (selection === "barrier") {
    await writeFile(path.join(root, `${process.pid}.ready`), "ready");
    while (
      !(await readFile(path.join(root, "start-gate")).catch(() => undefined))
    )
      await delay(10);
  }
  if (checkpoint === "hold-continuation") {
    const commit = SqliteLedger.prototype.commit;
    SqliteLedger.prototype.commit = function (revision, state, input) {
      const result = commit.call(this, revision, state, input);
      const events = Array.isArray(input) ? input : input ? [input] : [];
      if (
        events.some((event) => event.type === "operator.decision.continued")
      ) {
        writeFileSync(path.join(root, "owner-held"), String(process.pid));
        process.kill(process.pid, "SIGSTOP");
      }
      return result;
    };
  }
  let result;
  try {
    result = await fixture.embedded.answerAndResume(request);
  } catch (error) {
    result = { error: String(error) };
  }
  process.stdout.write(JSON.stringify(result) + "\n");
  fixture.store.close();
  process.exit(0);
}
const fixture = await createApprovalFixture(root, selection === "reject");
await writeFile(
  path.join(root, "request.json"),
  JSON.stringify(fixture.request),
);
const commit = SqliteLedger.prototype.commit;
SqliteLedger.prototype.commit = function (revision, state, input) {
  const events = Array.isArray(input) ? input : input ? [input] : [];
  const continuing = events.some(
    (event) => event.type === "operator.decision.continued",
  );
  if (continuing && checkpoint === "before-continuation-commit")
    process.exit(73);
  const result = commit.call(this, revision, state, input);
  if (continuing && checkpoint === "after-continuation-commit")
    process.exit(73);
  return result;
};
const transition = fixture.store.transitionPlanStep.bind(fixture.store);
fixture.store.transitionPlanStep = async (planId, stepId, input) => {
  if (
    stepId === "approve" &&
    (input.action === "complete" || input.action === "block") &&
    checkpoint === "before-approval-complete"
  )
    process.exit(73);
  const result = await transition(planId, stepId, input);
  if (
    stepId === "approve" &&
    (input.action === "complete" || input.action === "block") &&
    checkpoint === "after-approval-plan-commit"
  )
    process.exit(73);
  return result;
};
await fixture.embedded.answerAndResume({
  ...fixture.request,
  onEvent(event) {
    if (
      checkpoint === "after-answer" &&
      event.type === "operator.decision.answered"
    )
      process.exit(73);
    if (
      checkpoint === "after-approval-event" &&
      (event.type === "workflow.node.completed" ||
        event.type === "workflow.node.failed") &&
      event.payload["nodeId"] === "approve"
    )
      process.exit(73);
    if (
      checkpoint === "after-workflow-completed" &&
      (event.type === "workflow.completed" || event.type === "workflow.blocked")
    )
      process.exit(73);
  },
});
throw new Error("Crash checkpoint not reached");
