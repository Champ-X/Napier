import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("task status badge hierarchy", () => {
  it("keeps produced visually quieter than verified", () => {
    const css = readFileSync(
      new URL("../src/workspace-shell.css", import.meta.url),
      "utf8",
    );
    const produced = css.match(
      /\.task-status-badge\.is-produced\s*\{(?<rules>[^}]+)\}/u,
    )?.groups?.["rules"];
    const verified = css.match(
      /\.task-status-badge\.is-verified\s*\{(?<rules>[^}]+)\}/u,
    )?.groups?.["rules"];

    expect(produced).toContain("color: var(--color-fg-muted)");
    expect(produced).toContain("var(--color-success-surface) 34%");
    expect(produced).toContain("var(--color-success-border) 28%");
    expect(produced).not.toContain("background: var(--color-success-surface)");
    expect(produced).not.toContain("color: var(--color-success)");
    expect(verified).toContain("color: var(--color-success)");
    expect(verified).toContain("background: var(--color-success-surface)");
  });
});
