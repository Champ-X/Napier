import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  directoryPickerCommand,
  pickWorkspaceDirectory,
} from "../src/workspace-directory-picker.js";

describe("native workspace directory picker", () => {
  it("uses the macOS system folder chooser and normalizes its result", async () => {
    const command = vi.fn(async () => ({
      stdout: "/Users/operator/project/\n",
      stderr: "",
    }));

    await expect(pickWorkspaceDirectory("darwin", command)).resolves.toEqual({
      cancelled: false,
      path: "/Users/operator/project/",
    });
    expect(command.mock.calls[0]?.[0]).toBe("/usr/bin/osascript");
    expect(command.mock.calls[0]?.[1].join(" ")).toContain("choose folder");
  });

  it("maps the native cancel signal to a non-error result", async () => {
    const command = vi.fn(async () => {
      throw Object.assign(
        new Error("execution failed: User canceled. (-128)"),
        {
          code: 1,
        },
      );
    });

    await expect(pickWorkspaceDirectory("darwin", command)).resolves.toEqual({
      cancelled: true,
    });
  });

  it("preserves legal trailing spaces instead of trimming the selected path", async () => {
    await expect(
      pickWorkspaceDirectory("linux", async () => ({
        stdout: "/tmp/project \n",
        stderr: "",
      })),
    ).resolves.toEqual({ cancelled: false, path: "/tmp/project " });
  });

  it("rejects an invalid relative result from a native picker", async () => {
    await expect(
      pickWorkspaceDirectory("linux", async () => ({
        stdout: "relative/project\n",
        stderr: "",
      })),
    ).rejects.toThrow("non-absolute");
  });

  it("defines native commands for each supported desktop platform", () => {
    expect(directoryPickerCommand("darwin").executable).toBe(
      "/usr/bin/osascript",
    );
    expect(directoryPickerCommand("linux").executable).toBe(
      "/usr/bin/zenity",
    );
    expect(
      path.win32.isAbsolute(directoryPickerCommand("win32").executable),
    ).toBe(true);
    expect(directoryPickerCommand("win32").args.join(" ")).toContain(
      "OutputEncoding",
    );
  });
});
