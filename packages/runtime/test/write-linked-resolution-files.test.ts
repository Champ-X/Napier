import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  admitMissingWriteLinkedResolutionConfiguration,
  admitWriteLinkedResolutionConfiguration,
  loadWriteLinkedResolutionConfiguration,
  MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES,
  MAX_WRITE_LINKED_RESOLUTION_CONFIGS,
  MAX_WRITE_LINKED_RESOLUTION_TOTAL_BYTES,
  type LoadedWriteLinkedResolutionConfiguration,
} from "../src/write-linked-resolution-files.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("write-linked resolution files", () => {
  it("distinguishes missing configuration from unsafe files", async () => {
    const workspaceRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "napier-linked-resolution-files-")),
    );
    temporaryRoots.push(workspaceRoot);
    await mkdir(path.join(workspaceRoot, "config"));
    await writeFile(
      path.join(workspaceRoot, "config/valid.json"),
      '{"compilerOptions":{}}\n',
    );
    await symlink("valid.json", path.join(workspaceRoot, "config/linked.json"));
    await writeFile(
      path.join(workspaceRoot, "config/oversized.json"),
      Buffer.alloc(MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES + 1, 0x20),
    );

    await expect(
      loadWriteLinkedResolutionConfiguration(
        workspaceRoot,
        "config/valid.json",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "loaded",
        file: expect.objectContaining({
          path: "config/valid.json",
          fileBytes: 23,
        }),
      }),
    );
    await expect(
      loadWriteLinkedResolutionConfiguration(
        workspaceRoot,
        "config/missing.json",
      ),
    ).resolves.toEqual({ status: "missing" });
    await expect(
      loadWriteLinkedResolutionConfiguration(
        workspaceRoot,
        "config/linked.json",
      ),
    ).resolves.toEqual({ status: "unsafe" });
    await expect(
      loadWriteLinkedResolutionConfiguration(
        workspaceRoot,
        "config/oversized.json",
      ),
    ).resolves.toEqual({ status: "unsafe" });
  });

  it("enforces configuration count and total-byte admission", () => {
    const countBound = new Map<
      string,
      LoadedWriteLinkedResolutionConfiguration
    >();
    for (
      let index = 0;
      index < MAX_WRITE_LINKED_RESOLUTION_CONFIGS;
      index += 1
    ) {
      const loaded = configuration(`config/${String(index)}.json`, 1);
      expect(admitWriteLinkedResolutionConfiguration(countBound, loaded)).toBe(
        true,
      );
    }
    expect(
      admitWriteLinkedResolutionConfiguration(
        countBound,
        configuration("config/overflow.json", 1),
      ),
    ).toBe(false);

    const byteBound = new Map<
      string,
      LoadedWriteLinkedResolutionConfiguration
    >();
    for (
      let admittedBytes = 0;
      admittedBytes < MAX_WRITE_LINKED_RESOLUTION_TOTAL_BYTES;
      admittedBytes += MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES
    ) {
      expect(
        admitWriteLinkedResolutionConfiguration(
          byteBound,
          configuration(
            `config/bytes-${String(admittedBytes)}.json`,
            MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES,
          ),
        ),
      ).toBe(true);
    }
    expect(
      admitWriteLinkedResolutionConfiguration(
        byteBound,
        configuration("config/extra.json", 1),
      ),
    ).toBe(false);

    const missing = new Set<string>();
    for (
      let index = 0;
      index < MAX_WRITE_LINKED_RESOLUTION_CONFIGS;
      index += 1
    ) {
      expect(
        admitMissingWriteLinkedResolutionConfiguration(
          new Map(),
          missing,
          `config/missing-${String(index)}.json`,
        ),
      ).toBe(true);
    }
    expect(
      admitMissingWriteLinkedResolutionConfiguration(
        new Map(),
        missing,
        "config/missing-overflow.json",
      ),
    ).toBe(false);
    expect(
      admitWriteLinkedResolutionConfiguration(
        new Map(),
        configuration("config/loaded-after-reservations.json", 1),
        missing.size,
      ),
    ).toBe(false);
  });
});

function configuration(
  filePath: string,
  fileBytes: number,
): LoadedWriteLinkedResolutionConfiguration {
  return {
    path: filePath,
    source: "{}",
    fileSha256: "a".repeat(64),
    fileBytes,
  };
}
