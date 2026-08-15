import { describe, expect, it } from "vitest";

import { createOciContainerPathMapping } from "../src/sandbox-container-path-mapping.js";
import {
  PORTABLE_CONTAINER_USER_IDS,
  resolveContainerUserIdentity,
} from "../src/sandbox-container-runtime.js";
import { buildOciContainerArgs } from "../src/sandbox-oci-launch-arguments.js";
import { containerBindSourceMapper } from "../src/sandbox-container.js";
import type { SandboxLaunchRequest } from "../src/sandbox-types.js";

const REQUEST: SandboxLaunchRequest = {
  command: "/usr/local/bin/node",
  args: [
    "/opt/napier/node_modules/typescript/bin/tsc",
    "-p",
    "C:\\repo\\packages\\example\\tsconfig.json",
  ],
  cwd: "C:\\repo\\packages\\example",
  env: {
    CI: "1",
    GIT_INDEX_FILE: "C:\\repo\\.napier\\index",
  },
  workspaceRoot: "C:\\repo",
  approvedCapabilities: ["process.spawn", "workspace.read", "workspace.write"],
  workspaceWritePaths: ["C:\\repo\\generated"],
  runtimeReadPaths: ["C:\\toolchain\\node_modules"],
};

describe("OCI portable non-POSIX path mapping", () => {
  it("uses a fixed non-root identity and maps approved Windows paths", () => {
    const user = resolveContainerUserIdentity(undefined, "win32");
    const mapping = createOciContainerPathMapping(REQUEST, user, "win32");

    expect(user).toEqual(expect.objectContaining(PORTABLE_CONTAINER_USER_IDS));
    expect(mapping).toEqual({
      cwd: "/workspace/packages/example",
      command: "/usr/local/bin/node",
      args: [
        "/opt/napier/node_modules/typescript/bin/tsc",
        "-p",
        "/workspace/packages/example/tsconfig.json",
      ],
      environment: {
        CI: "1",
        GIT_INDEX_FILE: "/workspace/.napier/index",
      },
      workspaceTarget: "/workspace",
      writeTargets: ["/workspace/generated"],
      runtimeTargets: ["/opt/napier-host-runtime/0"],
    });
  });

  it("builds Docker mounts and argv against fixed container paths", () => {
    const user = resolveContainerUserIdentity(undefined, "win32");
    const mapping = createOciContainerPathMapping(REQUEST, user, "win32");
    const args = buildOciContainerArgs(
      REQUEST,
      "C:\\scratch",
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      `napier-${"b".repeat(32)}`,
      user,
      undefined,
      "linux/amd64",
      mapping,
      "win32",
    );
    const serialized = args.join("\0");

    expect(serialized).toContain("--platform\0linux/amd64");
    expect(serialized).toContain(["--user", "65532:65532"].join("\0"));
    expect(serialized).toContain("--workdir\0/workspace/packages/example");
    expect(serialized).toContain(
      "--mount\0type=bind,source=C:\\repo,target=/workspace,readonly",
    );
    expect(serialized).toContain(
      "--mount\0type=bind,source=C:\\repo\\generated,target=/workspace/generated",
    );
    expect(serialized).toContain(
      "--mount\0type=bind,source=C:\\toolchain\\node_modules,target=/opt/napier-host-runtime/0,readonly",
    );
    expect(args.slice(-2)).toEqual([
      "-p",
      "/workspace/packages/example/tsconfig.json",
    ]);
  });

  it("maps Windows bind sources only for an explicit WSL daemon", () => {
    const user = resolveContainerUserIdentity(undefined, "win32");
    const mapping = createOciContainerPathMapping(REQUEST, user, "win32");
    const mapper = containerBindSourceMapper(
      { NAPIER_CONTAINER_WINDOWS_WSL_MOUNTS: "1" },
      "win32",
    );
    const args = buildOciContainerArgs(
      REQUEST,
      "C:\\scratch",
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      `napier-${"b".repeat(32)}`,
      user,
      undefined,
      "linux/amd64",
      mapping,
      "win32",
      mapper,
    );
    const serialized = args.join("\0");

    expect(serialized).toContain(
      "--mount\0type=bind,source=/mnt/c/repo,target=/workspace,readonly",
    );
    expect(serialized).toContain(
      "--mount\0type=bind,source=/mnt/c/repo/generated,target=/workspace/generated",
    );
    expect(serialized).toContain(
      "--mount\0type=bind,source=/mnt/c/toolchain/node_modules,target=/opt/napier-host-runtime/0,readonly",
    );
    expect(serialized).toContain(
      "--env-file\0/mnt/c/scratch/environment.list",
    );
    expect(() => mapper("\\\\server\\share\\secret")).toThrow(
      "mount source is unsupported",
    );
    expect(() =>
      containerBindSourceMapper(
        { NAPIER_CONTAINER_WINDOWS_WSL_MOUNTS: "1" },
        "linux",
      ),
    ).toThrow("requires Windows");
  });

  it("rejects portable write and Git paths outside approved mounts", () => {
    const user = resolveContainerUserIdentity(undefined, "win32");

    expect(() =>
      createOciContainerPathMapping(
        {
          ...REQUEST,
          workspaceWritePaths: ["D:\\outside"],
        },
        user,
        "win32",
      ),
    ).toThrow("write path is outside approved mounts");
    expect(() =>
      createOciContainerPathMapping(
        {
          ...REQUEST,
          env: { GIT_INDEX_FILE: "D:\\outside\\index" },
        },
        user,
        "win32",
      ),
    ).toThrow("environment path is outside approved mounts");
    expect(() =>
      createOciContainerPathMapping(
        {
          ...REQUEST,
          args: ["D:\\outside\\secret.txt"],
        },
        user,
        "win32",
      ),
    ).toThrow("argument path is outside approved mounts");
  });

  it("adds a process-local safe directory only for the fixed workspace", () => {
    const user = resolveContainerUserIdentity(undefined, "win32");
    const mapping = createOciContainerPathMapping(
      {
        ...REQUEST,
        command: "/usr/bin/git",
        args: ["status", "--porcelain=v2"],
      },
      user,
      "win32",
    );

    expect(mapping.environment).toEqual(
      expect.objectContaining({
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "safe.directory",
        GIT_CONFIG_VALUE_0: "/workspace",
      }),
    );
    expect(JSON.stringify(mapping.environment)).not.toContain("*");
  });
});
