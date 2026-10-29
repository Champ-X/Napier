import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentProfile } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupSubagentHarnesses,
  createHarness,
  delegatedTask,
  inheritedTool,
  sha256,
  typedResult,
} from "./subagent-test-harness.js";

afterEach(cleanupSubagentHarnesses);

describe("SubagentCoordinator", () => {
  describe("child tool authority", () => {
    it.each(["researcher", "reviewer", "general"] as const)(
      "keeps %s baseline tools within the parent enabled set",
      async (role) => {
        const { coordinator, faux } = await createHarness({}, {
          enabledTools: ["list_files"],
          enabledSubagents: [role],
        });
        faux.setResponses([(context) => {
          expect(context.tools?.map((tool) => tool.name)).toEqual(["list_files"]);
          return fauxAssistantMessage(typedResult("Scoped tools inspected."));
        }]);
        await coordinator.createTool().execute("authority-baseline", {
          ...delegatedTask,
          role,
        });
      },
    );

    it("rejects a model call to a disabled inherited tool before admission", async () => {
      const execute = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "FORBIDDEN_NETWORK_RESULT" }],
        details: {},
      }));
      const { coordinator, faux, store, run } = await createHarness(
        {},
        { enabledTools: [] },
        () => [{ ...inheritedTool("web_search"), execute }],
      );
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("web_search", {}), { stopReason: "toolUse" }),
        (context) => {
          expect(context.tools ?? []).toEqual([]);
          expect(JSON.stringify(context.messages)).not.toContain("FORBIDDEN_NETWORK_RESULT");
          return fauxAssistantMessage(typedResult("Unavailable tool was rejected."));
        },
      ]);
      await coordinator.createTool().execute("authority-disabled", delegatedTask);
      expect(execute).not.toHaveBeenCalled();
      expect((await store.listRunEvents(run.id)).filter((event) =>
        event.type === "tool.admitted" || event.type === "tool.started",
      )).toEqual([]);
    });

    it("keeps allowed inherited tools governed without inheriting root writes", async () => {
      const forbidden = [
        "apply_patch", "workspace_file_apply", "lsp_rename_apply",
        "run_command", "delegate_task", "subagent_start", "candidate_file",
      ];
      const { coordinator, faux, store, run } = await createHarness(
        {},
        { enabledTools: [
          "web_search", "apply_patch", "workspace_file_apply", "lsp_rename_apply", "run_command",
        ] },
        () => [inheritedTool("web_search"), inheritedTool("read_file"), ...forbidden.map(inheritedTool)],
      );
      faux.setResponses([
        (context) => {
          const names = context.tools?.map((tool) => tool.name) ?? [];
          expect(names).toEqual(["web_search"]);
          for (const name of forbidden) expect(names).not.toContain(name);
          return fauxAssistantMessage(fauxToolCall("web_search", {}), { stopReason: "toolUse" });
        },
        fauxAssistantMessage(typedResult("Allowed research completed.")),
      ]);
      await coordinator.createTool().execute("authority-allowed", delegatedTask);
      const events = await store.listRunEvents(run.id);
      for (const type of ["tool.admitted", "tool.started", "tool.completed"]) {
        expect(events.filter((event) => event.type === type)).toEqual([
          expect.objectContaining({ payload: expect.objectContaining({ toolName: "web_search" }) }),
        ]);
      }
    });

    it.each([false, true])("derives skill_resource only from enabled skill_load (%s)", async (enabled) => {
      const { coordinator, faux } = await createHarness(
        {},
        { enabledTools: enabled ? ["skill_load"] : [] },
        () => [inheritedTool("skill_load"), inheritedTool("skill_resource")],
      );
      faux.setResponses([(context) => {
        expect(context.tools?.map((tool) => tool.name) ?? []).toEqual(
          enabled ? ["skill_load", "skill_resource"] : [],
        );
        return fauxAssistantMessage(typedResult("Derived skill scope inspected."));
      }]);
      await coordinator.createTool().execute("authority-skills", delegatedTask);
    });

    it("does not synthesize skill tools when the parent has no active snapshot", async () => {
      const { coordinator, faux } = await createHarness({}, { enabledTools: ["skill_load"] });
      faux.setResponses([(context) => {
        expect(context.tools ?? []).toEqual([]);
        return fauxAssistantMessage(typedResult("Missing skill snapshot retained."));
      }]);
      await coordinator.createTool().execute("authority-no-snapshot", delegatedTask);
    });

    it("snapshots parent tool grants before inherited tool construction", async () => {
      let profile: AgentProfile | undefined;
      const input = await createHarness(
        {},
        { enabledTools: ["list_files"] },
        () => {
          profile!.enabledTools.push("read_file");
          return [inheritedTool("read_file")];
        },
      );
      profile = input.profile;
      input.faux.setResponses([(context) => {
        expect(context.tools?.map((tool) => tool.name)).toEqual(["list_files"]);
        return fauxAssistantMessage(typedResult("Initial grants retained."));
      }]);
      await input.coordinator.createTool().execute("authority-snapshot", delegatedTask);
    });

    it("keeps coder lifecycle grants without restoring disabled candidate reads or AST tools", async () => {
      const { coordinator, faux, store } = await createHarness({}, {
        enabledSubagents: ["coder"],
        enabledTools: ["apply_patch", "lsp_diagnostics"],
        toolPolicy: "workspace",
      });
      const source = "unchanged\n";
      await writeFile(path.join(store.workspaceRoot, "value.txt"), source);
      faux.setResponses([
        (context) => {
          expect(context.tools?.map((tool) => tool.name)).toEqual([
            "apply_patch", "candidate_file", "lsp_diagnostics",
          ]);
          return fauxAssistantMessage(fauxToolCall("apply_patch", {
            operation: "replace", path: "value.txt", expectedSha256: sha256(source),
            edits: [{ oldText: "unchanged", newText: "candidate" }],
          }), { stopReason: "toolUse" });
        },
        fauxAssistantMessage(typedResult("Candidate scope inspected.")),
      ]);
      await coordinator.createTool().execute("authority-coder", {
        ...delegatedTask,
        role: "coder",
        writePaths: ["value.txt"],
      });
      expect(await readFile(path.join(store.workspaceRoot, "value.txt"), "utf8")).toBe("unchanged\n");
    });

    it("keeps the candidate reader instead of an inherited root reader with the same name", async () => {
      const inheritedRead = vi.fn(inheritedTool("read_file").execute);
      const { coordinator, faux, store } = await createHarness({}, {
        enabledSubagents: ["coder"],
        enabledTools: ["read_file", "apply_patch", "lsp_diagnostics"],
        toolPolicy: "workspace",
      }, () => [{ ...inheritedTool("read_file"), execute: inheritedRead }]);
      const source = "parent value\n";
      await writeFile(path.join(store.workspaceRoot, "value.txt"), source);
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("apply_patch", {
          operation: "replace", path: "value.txt", expectedSha256: sha256(source),
          edits: [{ oldText: "parent value", newText: "private candidate value" }],
        }), { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall("read_file", { path: "value.txt" }), { stopReason: "toolUse" }),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain("private candidate value");
          expect(inheritedRead).not.toHaveBeenCalled();
          return fauxAssistantMessage(typedResult("Private candidate read verified."));
        },
      ]);
      await coordinator.createTool().execute("authority-candidate-read", {
        ...delegatedTask, role: "coder", writePaths: ["value.txt"],
      });
      expect(await readFile(path.join(store.workspaceRoot, "value.txt"), "utf8")).toBe(source);
    });
  });

});
