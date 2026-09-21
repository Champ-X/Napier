import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { taskInputIdentity } from "./harness-sample-identity.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function inventorySuiteTree(root, prefix = "") {
  if (!(await lstat(path.join(root, prefix))).isDirectory())
    throw new Error("Suite input must be a real directory");
  const files = {};
  for (const entry of (
    await readdir(path.join(root, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory())
      Object.assign(files, await inventorySuiteTree(root, relative));
    else if (entry.isFile())
      files[relative] = hash(await readFile(path.join(root, relative)));
    else throw new Error("Suite input links and special files are unsupported");
  }
  return files;
}

/** Snapshot each complete case before any model execution. Reject aliases and
 * reused IDs; a renamed copy is not a new independent qualification case. */
export async function prepareHarnessSuite(suitePath, output) {
  const raw = await readFile(suitePath, "utf8"),
    suite = JSON.parse(raw);
  if (
    suite.kind !== "napier.harness-optimization-suite" ||
    suite.schemaVersion !== 1 ||
    typeof suite.id !== "string" ||
    !/^[a-z0-9_-]+$/u.test(suite.id) ||
    !Array.isArray(suite.cases) ||
    !suite.cases.length ||
    suite.cases.length > 100
  )
    throw new Error("Invalid Harness suite definition");
  const ids = new Set(),
    identities = new Set(),
    cases = [];
  await mkdir(output, { recursive: false });
  for (const item of suite.cases) {
    if (
      !item ||
      typeof item.path !== "string" ||
      path.isAbsolute(item.path) ||
      item.path.split(/[\\/]/u).includes("..") ||
      !Array.isArray(item.coverage) ||
      !item.coverage.length ||
      !item.coverage.every(
        (t) => typeof t === "string" && /^[a-z][a-z0-9_-]*$/u.test(t),
      )
    )
      throw new Error("Invalid suite case path/coverage");
    const source = path.resolve(path.dirname(suitePath), item.path);
    if (
      (await realpath(source)) !==
      path.resolve(await realpath(path.dirname(suitePath)), item.path)
    )
      throw new Error("Suite input ancestor links are unsupported");
    const manifest = JSON.parse(
      await readFile(path.join(source, "manifest.json"), "utf8"),
    );
    if (
      typeof manifest.id !== "string" ||
      !/^[a-z0-9_-]+$/u.test(manifest.id) ||
      ids.has(manifest.id)
    )
      throw new Error("Invalid or duplicate suite case ID");
    const files = await inventorySuiteTree(source);
    const inputs = {};
    for (const key of ["promptPath", "outcomeTestPath", "memorySeedPath"]) {
      const file = manifest[key];
      if (file === undefined && key === "memorySeedPath") continue;
      if (typeof file !== "string" || files[file] === undefined)
        throw new Error("Suite case input is missing or outside its snapshot");
      inputs[key] = files[file];
    }
    if (
      typeof manifest.fixturePath !== "string" ||
      path.isAbsolute(manifest.fixturePath) ||
      manifest.fixturePath.split(/[\\/]/u).includes("..")
    )
      throw new Error("Invalid suite fixture path");
    inputs.fixture = await inventorySuiteTree(
      path.join(source, manifest.fixturePath),
    );
    const inputSha256 = hash(JSON.stringify(inputs));
    const taskIdentity = taskInputIdentity({
      fixtureSha256: hash(JSON.stringify(inputs.fixture)),
      promptSha256: inputs.promptPath,
      memorySeedSha256: inputs.memorySeedPath,
    });
    if (identities.has(taskIdentity))
      throw new Error("Duplicate suite task inputs");
    const destination = path.join(output, manifest.id);
    await cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    if (
      JSON.stringify(await inventorySuiteTree(destination)) !==
      JSON.stringify(files)
    )
      throw new Error("Suite inputs changed while snapshotting");
    ids.add(manifest.id);
    identities.add(taskIdentity);
    cases.push({
      id: manifest.id,
      path: destination,
      coverage: [...new Set(item.coverage)],
      inputSha256,
      files,
    });
  }
  const receipt = {
    kind: "napier.harness-suite-inputs",
    schemaVersion: 1,
    id: suite.id,
    suiteSha256: hash(raw),
    cases,
  };
  await writeFile(
    path.join(output, "inputs.json"),
    JSON.stringify(receipt, null, 2),
    { flag: "wx" },
  );
  return receipt;
}

/** Wait for every started job, including failed/cancelled ones. An aborted
 * queue never starts new work, and no retry overwrites a failed observation. */
export async function executeSuiteJobs(
  jobs,
  execute,
  { concurrency = 2, signal } = {},
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error("Suite concurrency must be 1-4");
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (!signal?.aborted) {
        const index = next++;
        if (index >= jobs.length) break;
        try {
          results[index] = {
            job: jobs[index],
            status: "settled",
            result: await execute(jobs[index], signal),
          };
        } catch (error) {
          results[index] = {
            job: jobs[index],
            status: "failed",
            error: String(error.message ?? error),
          };
        }
      }
    }),
  );
  return jobs.map(
    (job, index) => results[index] ?? { job, status: "not_started" },
  );
}
