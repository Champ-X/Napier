const validHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const validId = (value) => typeof value === "string" && value.trim().length > 0;

/** Captured input equality detects aliases, not semantic task independence.
 * Graders belong to a case definition but cannot create a distinct task. */
export function taskInputIdentity({
  fixtureSha256,
  promptSha256,
  memorySeedSha256,
}) {
  return JSON.stringify([
    fixtureSha256,
    promptSha256,
    memorySeedSha256 ?? null,
  ]);
}

export function evaluateSampleIdentity(reports) {
  const blockers = [],
    invalidPairs = new Set();
  const runs = new Map(),
    cases = new Map(),
    tasks = new Map();
  const add = (map, id, report) => {
    const group = map.get(id) ?? [];
    group.push(report);
    map.set(id, group);
  };
  const reject = (group, reason) => {
    blockers.push(reason);
    for (const report of group)
      invalidPairs.add(`${report.caseId}:${report.trial}`);
  };
  for (const report of reports) {
    const valid =
      validId(report.caseId) &&
      validId(report.runId) &&
      Number.isSafeInteger(report.trial) &&
      report.trial >= 0 &&
      ["fixtureSha256", "promptSha256", "outcomeSha256"].every((key) =>
        validHash(report[key]),
      ) &&
      ["memorySeedSha256", "acceptanceSha256"].every(
        (key) => report[key] == null || validHash(report[key]),
      );
    if (!valid)
      reject(
        [report],
        `${report.caseId}:${report.trial}: invalid sample identity`,
      );
    // Invalid observations still participate in reuse checks, so a valid alias
    // cannot conceal a malformed or adverse observation of the same Run.
    if (validId(report.runId)) add(runs, report.runId, report);
    if (validId(report.caseId)) add(cases, report.caseId, report);
    if (valid) add(tasks, taskInputIdentity(report), report);
  }
  for (const [runId, group] of runs)
    if (group.length > 1)
      reject(group, `${runId}: reused Run across campaign observations`);
  for (const [caseId, group] of cases) {
    const definitions = new Set(
      group.map((report) =>
        JSON.stringify([
          taskInputIdentity(report),
          report.outcomeSha256,
          report.acceptanceSha256 ?? null,
        ]),
      ),
    );
    if (definitions.size > 1)
      reject(group, `${caseId}: case definition changed across observations`);
  }
  for (const group of tasks.values()) {
    const ids = new Set(group.map((report) => report.caseId));
    if (ids.size > 1)
      reject(
        group,
        `${[...ids].join(", ")}: duplicate task inputs across case IDs`,
      );
  }
  return { blockers, invalidPairs };
}
