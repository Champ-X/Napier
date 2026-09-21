import { expect, it } from "vitest";
import { claimedUnavailableCapabilityTools } from "../src/capability-availability-guard.js";

it("does not turn missing isolation or test coverage into an unavailable execution tool", () => {
  for (const text of [
    "All commands ran host-direct (no OS isolation); `run_command` was bounded Node/Python work.",
    "run_command runs with no OS isolation.",
    "No tests were modified. run_command completed successfully.",
    "No boundary test exists in this repo. I ran independent assertions.",
    "没有 OS 隔离；run_command 已执行成功。",
    "Tests, bytecode disabled: `workspace_process` runtime=python ran unittest successfully.",
    "Tests (bytecode disabled): `workspace_process` returned OK.",
    "The formatter is unavailable, but run_command completed the tests.",
    "I made no network calls and touched only the requested files.",
    "There were no network requests, no edit failures, and no shell errors.",
    "The run_command tool is not disabled.",
    "网络并非不可用。",
    "No shell commands were run.",
    "I made no network connections.",
    "No edit was performed.",
    "No write targeted any file other than src/fees.mjs.",
    "No write in this run or the recovered run targeted README.md.",
    "No patch from the earlier phase changed the module.",
    "No shell was used during verification.",
    "No run_command invocation touched files outside the workspace.",
    "没有网络请求，也没有修改文件。",
  ])
    expect(claimedUnavailableCapabilityTools(text), text).toEqual([]);
});

it("retains direct and qualified capability denial checks in English and Chinese", () => {
  for (const text of [
    "I have no run_command tool.",
    "There is no available shell tool.",
    "The run_command tool is currently unavailable.",
    "run_command is missing.",
    "I cannot use apply_patch in this environment.",
    "当前没有可用的命令工具。",
    "无法使用 run_command。",
    "web_search、web_fetch、workspace_process、run_command 和 apply_patch 均不可用。",
    "run_command and workspace_process are disabled.",
    "I cannot invoke run_command or workspace_process.",
    "There are no network calls allowed.",
    "The network requests are disabled.",
    "The workspace_process tool has been disabled.",
    "I am unable to use run_command.",
    "I am not able to invoke workspace_process.",
    "No shell access is available.",
    "No write access is available in this run.",
    "No write in this run is allowed.",
    "No shell tool was available during verification.",
    "没有网络请求权限，也没有修改文件的能力。",
  ])
    expect(
      claimedUnavailableCapabilityTools(text).length,
      text,
    ).toBeGreaterThan(0);
});

it("binds a denial only to its subject while retaining independently usable capabilities", () => {
  expect(
    claimedUnavailableCapabilityTools(
      "Bytecode is disabled, run_command is available, but workspace_process is unavailable.",
    ),
  ).toEqual(["workspace_process"]);
  expect(
    claimedUnavailableCapabilityTools(
      "web_search、web_fetch、workspace_process、run_command 和 apply_patch 均不可用。",
    ),
  ).toEqual(
    expect.arrayContaining([
      "web_search",
      "web_fetch",
      "workspace_process",
      "run_command",
      "apply_patch",
    ]),
  );
});
