import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  realpath,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { VerificationRunner } from "../src/verification.js";
import { selectVerificationTestRunner } from "../src/verification-test-runner.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { OciContainerSandboxAdapter } from "../src/sandbox-oci.js";
import { sha256 } from "../src/ed25519.js";

const roots: string[] = [];
const source =
  "import {test} from 'node:test';import assert from 'node:assert/strict';test('native arithmetic',()=>assert.equal(2+2,4));\n";
async function fixture(base = os.tmpdir()) {
  await mkdir(base, { recursive: true });
  const root = await realpath(
    await mkdtemp(path.join(base, "napier-native-test-")),
  );
  roots.push(root);
  await mkdir(path.join(root, "test"));
  await writeFile(path.join(root, "test/native.test.mjs"), source);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("runs real native tests without an installed Vitest CLI and retains failing outcomes", async () => {
  const root = await fixture();
  const runner = new VerificationRunner({
    workspaceRoot: root,
    sandbox: new HostDirectSandboxAdapter(),
  });
  const full = await runner.run({ kind: "test" });
  expect(full.details.status, full.stderr).toBe("passed");
  expect(full.details.testRunner).toBe("node-test");
  expect(full.details.verifierSha256).toBe(
    sha256(await readFile(process.execPath)),
  );
  expect(full.stdout).toContain("native arithmetic");
  expect((await runner.runSelectedTests(["test/native.test.mjs"])).status).toBe(
    "passed",
  );
  await writeFile(
    path.join(root, "test/native.test.mjs"),
    source.replace("2+2,4", "2+2,5"),
  );
  expect((await runner.run({ kind: "test" })).details.status).toBe("failed");
  await expect(
    runner.run({ kind: "format", testRunner: "node-test" }),
  ).rejects.toThrow("Unsupported verification");
  await expect(
    runner.runSelectedTests(["../outside.test.mjs"]),
  ).rejects.toThrow("escapes");
});

it("does not infer native execution from comments, strings or type-only imports, and does not silently omit mixed tests", async () => {
  const root = await fixture();
  const other = path.join(root, "test/other.test.ts");
  await writeFile(
    other,
    `// import test from 'node:test';\nconst hint="node:test";\nimport type {TestContext} from 'node:test';\nimport {type Mock} from 'node:test';\nimport {test} from 'vitest';\n`,
  );
  expect((await selectVerificationTestRunner(root, [other])).runner).toBe(
    "vitest",
  );
  await expect(selectVerificationTestRunner(root, [root])).rejects.toThrow(
    "Mixed or indirect",
  );
  expect(
    (await selectVerificationTestRunner(root, [other], "node-test")).targets,
  ).toEqual([other]);
});

it.runIf(Boolean(process.env.NAPIER_TEST_NATIVE_NODE_IMAGE))(
  "executes native tests through the real OCI read-only verifier",
  async () => {
    const root = await fixture(
      process.env.NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR ??
        path.join(os.homedir(), ".cache/napier-native-tests"),
    );
    const image = process.env.NAPIER_TEST_NATIVE_NODE_IMAGE!;
    expect(image).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const sandbox = new OciContainerSandboxAdapter(image);
    const runner = new VerificationRunner({ workspaceRoot: root, sandbox });
    await writeFile(
      path.join(root, "test/native.test.mjs"),
      source +
        "import {writeFileSync} from 'node:fs';test('workspace remains read only',()=>assert.throws(()=>writeFileSync(new URL('../forbidden',import.meta.url),'x')));\n",
    );
    const result = await runner.run({ kind: "test", timeoutMs: 30000 });
    expect(result.details.status, result.stderr).toBe("passed");
    expect(result.details.sandbox).toBe("oci-container");
    expect(result.details.testRunner).toBe("node-test");
    expect(result.details.runtimeIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.stdout).toContain("workspace remains read only");
    expect(
      (await runner.runSelectedTests(["test/native.test.mjs"], 30000)).status,
    ).toBe("passed");
  },
  60000,
);
