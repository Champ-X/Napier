import { describe, expect, it } from "vitest";

import { stableWorkspaceProjects } from "../src/WorkspaceTree";

describe("workspace tree ordering", () => {
  it("keeps the registry order when the active workspace changes", () => {
    const projects = [
      { root: "/work/alpha", name: "alpha" },
      { root: "/work/beta", name: "beta" },
      { root: "/work/gamma", name: "gamma" },
      { root: "/work/beta", name: "beta duplicate" },
    ];

    expect(
      stableWorkspaceProjects("/work/gamma", projects).map(
        (project) => project.root,
      ),
    ).toEqual(["/work/alpha", "/work/beta", "/work/gamma"]);
  });

  it("appends an unregistered active workspace without moving known roots", () => {
    expect(
      stableWorkspaceProjects("/work/new", [
        { root: "/work/alpha", name: "alpha" },
        { root: "/work/beta", name: "beta" },
      ]).map((project) => project.root),
    ).toEqual(["/work/alpha", "/work/beta", "/work/new"]);
  });

  it("derives missing workspace names across path separator styles", () => {
    const windowsRoot = String.raw`C:\work\napier`;

    expect(stableWorkspaceProjects(windowsRoot, [])).toEqual([
      { root: windowsRoot, name: "napier" },
    ]);
    expect(stableWorkspaceProjects("/work/napier", [])).toEqual([
      { root: "/work/napier", name: "napier" },
    ]);
  });
});
