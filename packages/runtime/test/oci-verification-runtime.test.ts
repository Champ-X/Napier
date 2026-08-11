import { describe, expect, it, vi } from "vitest";

import { OciContainerSandboxAdapter } from "../src/sandbox.js";
import type { ContainerClient } from "../src/sandbox-container-runtime.js";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const REQUESTED_IMAGE = "napier-sandbox:0.1.0";
const USER_IDS = { userId: 501, groupId: 20 } as const;
const DAEMON_ENDPOINT = "unix:///controlled/docker.sock";

describe("OCI verification runtime", () => {
  it("binds image Node, manifests, and all three verifier identities", async () => {
    const client = verificationClient();
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });

    await expect(sandbox.resolveVerificationRuntime()).resolves.toEqual(
      expect.objectContaining({
        runtime: "verification",
        nodeExecutable: "/usr/local/bin/node",
        nodeExecutableSha256: "1".repeat(64),
        toolchainRoot: "/opt/napier",
        packageJsonSha256: "2".repeat(64),
        packageLockSha256: "3".repeat(64),
        typecheckPath: "/opt/napier/node_modules/typescript/bin/tsc",
        typecheckVersion: "5.9.3",
        typecheckSha256: "4".repeat(64),
        testPath: "/opt/napier/node_modules/vitest/vitest.mjs",
        testVersion: "4.1.9",
        testSha256: "5".repeat(64),
        formatPath: "/opt/napier/node_modules/prettier/bin/prettier.cjs",
        formatVersion: "3.8.4",
        formatSha256: "6".repeat(64),
        runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(client).toHaveBeenCalledTimes(2);
  });

  it("fails closed for missing or escaping verification assets", async () => {
    const missing = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: verificationClient({ missing: true }),
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });
    await expect(missing.resolveVerificationRuntime()).rejects.toThrow(
      "image-bound verification runtime is unavailable",
    );

    const escaping = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: verificationClient({ escaping: true }),
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });
    await expect(escaping.resolveVerificationRuntime()).rejects.toThrow(
      "verification identity is invalid",
    );
  });
});

function verificationClient(
  options: { missing?: boolean; escaping?: boolean } = {},
) {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `${IMAGE_ID}\tlinux\tarm64\n`;
    if (args[0] === "container") return "";
    return JSON.stringify({
      node: {
        executable: "/usr/local/bin/node",
        executableSha256: "1".repeat(64),
      },
      shell: null,
      git: null,
      lsp: null,
      verification: options.missing
        ? null
        : {
            toolchainRoot: "/opt/napier",
            packageJsonSha256: "2".repeat(64),
            packageLockSha256: "3".repeat(64),
            typecheck: {
              path: options.escaping
                ? "/outside/tsc"
                : "/opt/napier/node_modules/typescript/bin/tsc",
              version: "5.9.3",
              sha256: "4".repeat(64),
            },
            test: {
              path: "/opt/napier/node_modules/vitest/vitest.mjs",
              version: "4.1.9",
              sha256: "5".repeat(64),
            },
            format: {
              path: "/opt/napier/node_modules/prettier/bin/prettier.cjs",
              version: "3.8.4",
              sha256: "6".repeat(64),
            },
          },
      debugger: null,
      python: null,
    });
  });
}
