import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { selectAffectedTests } from "../src/affected-test-selection.js";
import { createPlatformSandboxAdapter } from "../src/sandbox.js";
import { createVerificationTool } from "../src/verification.js";
import { withToolchainProviders } from "../src/toolchain-provider.js";
import { createWorkspacePathSnapshot } from "../src/workspace-snapshot.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";
import type { RunEvent } from "@napier/contracts";

const roots: string[] = [];
const liveIt = it.runIf(process.env.NAPIER_LIVE_TOOLCHAIN_SMOKE === "1");
liveIt.each([
  [
    "aliased dynamic import",
    "from importlib import import_module as load\nmodule = load('price')\n",
    "dynamic_code_or_import",
  ],
  [
    "aliased search path",
    "from sys import path as search\nsearch.append('vendor')\n",
    "dynamic_search_path",
  ],
])("retains full Python scope for %s", async (_label, text, reason) => {
  const f = await fixture({
    "price.py": "value=2\n",
    "test_price.py": "import price\n" + text,
  });
  const selection = await selectAffectedTests(f, {
    runtime: "python",
    affectedBy: ["price.py"],
  });
  expect(selection.mode).toBe("full_suite_fallback");
  expect(selection.reasons).toContain(reason);
});

liveIt(
  "retains full Python scope when a changed module supplies shared pytest fixtures",
  async () => {
    const f = await fixture({
      "price.py": "value=2\n",
      "conftest.py": "from price import value\n",
      "test_price.py": "import price\n",
      "test_indirect.py":
        "def test_fixture(shared_price): assert shared_price == 2\n",
    });
    const selection = await selectAffectedTests(f, {
      runtime: "python",
      affectedBy: ["price.py"],
    });
    expect(selection.mode).toBe("full_suite_fallback");
    expect(selection.reasons).toContain("shared_test_configuration");
  },
);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(files: Record<string, string>) {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "napier-affected-tests-"),
  );
  roots.push(workspaceRoot);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(workspaceRoot, file)), {
      recursive: true,
    });
    await writeFile(path.join(workspaceRoot, file), text);
  }
  const options = { workspaceRoot, sandbox: createPlatformSandboxAdapter() };
  return {
    ...options,
    verify: withToolchainProviders(
      [createVerificationTool(options)],
      options,
    )[0]!,
  };
}

it("selects transitive Node importers and retains full scope for configuration or no-match changes", async () => {
  const f = await fixture({
    "src/a.ts": "export const a=1;",
    "src/b.ts": "export {a} from './a.js';",
    "test/a.test.ts": "import {a} from '../src/b.js';",
    "test/other.test.ts": "const n=2;",
    "package.json": "{}",
    "src/unused.ts": "export const n=1;",
  });
  const selected = await selectAffectedTests(f, {
    runtime: "node",
    affectedBy: ["src/a.ts"],
  });
  expect(selected.mode).toBe("selected");
  expect(selected.selectedTests).toEqual(["test/a.test.ts"]);
  expect(
    (
      await selectAffectedTests(f, {
        runtime: "node",
        affectedBy: ["package.json"],
      })
    ).mode,
  ).toBe("full_suite_fallback");
  expect(
    (
      await selectAffectedTests(f, {
        runtime: "node",
        affectedBy: ["src/unused.ts"],
      })
    ).reasons,
  ).toContain("no_static_match");
  await expect(
    selectAffectedTests(f, { runtime: "node", affectedBy: ["../outside.ts"] }),
  ).rejects.toThrow();
  await expect(
    f.verify.execute("invalid", {
      runtime: "node",
      kind: "typecheck",
      affectedBy: ["src/a.ts"],
    }),
  ).rejects.toThrow("kind=test");
});

liveIt(
  "selects Python transitive and relative imports without importing workspace modules",
  async () => {
    const f = await fixture({
      "pkg/__init__.py": "",
      "pkg/price.py":
        "raise RuntimeError('must never import during selection')\n",
      "pkg/quote.py": "from . import price\n",
      "tests/test_quote.py": "from pkg import quote\n",
      "tests/test_other.py": "import unittest\n",
    });
    const before = await createWorkspacePathSnapshot(
      f.workspaceRoot,
      f.workspaceRoot,
    );
    const selected = await selectAffectedTests(f, {
      runtime: "python",
      affectedBy: ["pkg/price.py"],
    });
    expect(selected.mode, JSON.stringify(selected)).toBe("selected");
    expect(selected.selectedTests).toEqual(["tests/test_quote.py"]);
    expect(
      (await createWorkspacePathSnapshot(f.workspaceRoot, f.workspaceRoot))
        .sha256,
    ).toBe(before.sha256);
  },
);

liveIt(
  "does not narrow Python tests when imports are dynamic or candidate count is capped",
  async () => {
    const f = await fixture({
      "price.py": "value=2",
      "test_price.py": "import importlib\nm=importlib.import_module('price')\n",
    });
    expect(
      (
        await selectAffectedTests(f, {
          runtime: "python",
          affectedBy: ["price.py"],
        })
      ).reasons,
    ).toContain("dynamic_code_or_import");
    await writeFile(
      path.join(f.workspaceRoot, "test_price.py"),
      "import price\n",
    );
    for (let i = 0; i < 9; i++)
      await writeFile(
        path.join(f.workspaceRoot, `test_extra_${i}.py`),
        "import price\n",
      );
    const capped = await selectAffectedTests(f, {
      runtime: "python",
      affectedBy: ["price.py"],
    });
    expect(capped.mode).toBe("full_suite_fallback");
    expect(capped.reasons).toContain("test_limit");
  },
);

liveIt(
  "executes the selected nested Python tests and catches a behavioral regression without helper files",
  async () => {
    const f = await fixture({
      "price.py": "def total(n): return n*2\n",
      "tests/test_price.py":
        "import unittest\nfrom price import total\nclass TestPrice(unittest.TestCase):\n def test_total(self): self.assertEqual(total(3),6)\n",
      "tests/test_other.py":
        "raise RuntimeError('unrelated test must not run')\n",
    });
    const input = { runtime: "python", kind: "test", affectedBy: ["price.py"] };
    const first = await f.verify.execute("selected", input);
    expect(first.details.status, JSON.stringify(first.content)).toBe("passed");
    expect(first.details.selectionMode).toBe("selected");
    expect(first.details.selectedTestCount).toBe(1);
    const state = projectTaskWorkingState({
      runId: "run_tests",
      events: [
        {
          id: "event_tests",
          runId: "run_tests",
          threadId: "thread_tests",
          seq: 1,
          type: "tool.completed",
          category: "tool",
          visibility: "debug",
          createdAt: new Date().toISOString(),
          payload: { toolName: "verify_workspace", details: first.details },
        } as RunEvent,
      ],
      workspace: await createWorkspacePathSnapshot(
        f.workspaceRoot,
        f.workspaceRoot,
        { includeDirectories: true },
      ),
    });
    expect(state.verifications[0]?.freshness).toBe("current");
    await writeFile(
      path.join(f.workspaceRoot, "price.py"),
      "def total(n): return n*3\n",
    );
    expect((await f.verify.execute("failed", input)).details.status).toBe(
      "failed",
    );
    expect(
      await readFile(path.join(f.workspaceRoot, "tests/test_price.py"), "utf8"),
    ).toContain("assertEqual(total(3),6)");
  },
);

liveIt(
  "falls back to real full discovery for unknown imports, and never treats zero tests as success",
  async () => {
    const f = await fixture({
      "price.py": "value=2\n",
      "test_dynamic.py":
        "import unittest,importlib\nm=importlib.import_module('price')\nclass TestPrice(unittest.TestCase):\n def test_value(self): self.assertEqual(m.value,2)\n",
    });
    const first = await f.verify.execute("full", {
      runtime: "python",
      kind: "test",
      affectedBy: ["price.py"],
    });
    expect(first.details.status, JSON.stringify(first.content)).toBe("passed");
    expect(first.details.selectionMode).toBe("full_suite_fallback");
    await rm(path.join(f.workspaceRoot, "test_dynamic.py"));
    expect(
      (
        await f.verify.execute("empty", {
          runtime: "python",
          kind: "test",
          affectedBy: ["price.py"],
        })
      ).details.status,
    ).not.toBe("passed");
  },
);
