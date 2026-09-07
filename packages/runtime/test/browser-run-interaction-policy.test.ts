import { describe, expect, it } from "vitest";
import type { RunRecord } from "@napier/contracts";

import { canConfirmBrowserInteraction } from "../src/browser-run-interaction-policy.js";

describe("Browser interaction entry points", () => {
  it.each([
    [{ source: "user" }, false, true],
    [{ source: "recovery", parentRunId: "run_origin" }, false, true],
    [{ source: "recovery", parentRunId: "run_origin" }, true, false],
    [{ source: "recovery" }, false, false],
    [{ source: "schedule" }, false, false],
    [{ source: "workflow", parentRunId: "run_origin" }, false, false],
    [{ source: "user" }, true, false],
  ] satisfies Array<
    [Pick<RunRecord, "source" | "parentRunId">, boolean, boolean]
  >)(
    "keeps interactive authority scoped to unrestricted user continuations: %j",
    (run, restricted, expected) => {
      expect(canConfirmBrowserInteraction(run, restricted)).toBe(expected);
    },
  );
});
