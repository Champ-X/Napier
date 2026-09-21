import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { exportRunInputReproduction } from "../packages/runtime/dist/run-input-reproduction.js";

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    "data-root": { type: "string" },
    thread: { type: "string" },
    run: { type: "string" },
    output: { type: "string" },
    "external-outcome-review": { type: "string" },
  },
});
if (
  !["workspace", "data-root", "thread", "run", "output"].every(
    (key) => values[key],
  )
)
  throw new Error(
    "Specify --workspace, --data-root, --thread, --run and a new --output directory",
  );
const dataRoot = path.resolve(values["data-root"]);
const db = new DatabaseSync(path.join(dataRoot, "ledger.sqlite"), {
  readOnly: true,
});
let run, events;
try {
  db.exec("BEGIN");
  const row = db
    .prepare("SELECT state_json FROM workspace_state WHERE singleton=1")
    .get();
  run = JSON.parse(row.state_json).runs.find(
    (item) => item.id === values.run && item.threadId === values.thread,
  );
  if (!run) throw new Error("Source Run not found");
  events = db
    .prepare(
      "SELECT event_json FROM ledger_events WHERE thread_id=? AND run_id=? ORDER BY seq",
    )
    .all(values.thread, values.run)
    .map((row) => JSON.parse(row.event_json));
  if (
    !events.some(
      (e) =>
        e.type === `run.${run.status}` &&
        ["completed", "failed", "cancelled", "interrupted"].includes(
          run.status,
        ),
    )
  )
    throw new Error(
      "Run snapshot and terminal event do not establish a settled source",
    );
  db.exec("COMMIT");
} finally {
  db.close();
}
const store = {
  dataRoot,
  workspaceRoot: path.resolve(values.workspace),
  listRuns: (threadId) => (threadId === values.thread ? [run] : []),
  listRunEvents: async (runId) => (runId === values.run ? events : []),
};
console.log(
  JSON.stringify(
    await exportRunInputReproduction({
      store,
      threadId: values.thread,
      runId: values.run,
      output: values.output,
      ...(values["external-outcome-review"]
        ? {
            externalOutcomeReview: JSON.parse(
              await readFile(values["external-outcome-review"], "utf8"),
            ),
          }
        : {}),
    }),
  ),
);
