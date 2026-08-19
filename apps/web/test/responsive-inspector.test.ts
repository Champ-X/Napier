import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Responsive Inspector", () => {
  it("keeps the Inspector in a default-closed drawer at every width", async () => {
    const [source, shellStyles, inspectorStyles] = await Promise.all([
      readFile(
        new URL("../src/ResponsiveInspector.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/styles/shell-navigation.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/styles/inspector.css", import.meta.url), "utf8"),
    ]);
    const styles = `${shellStyles}\n${inspectorStyles}`;

    expect(source).toContain('className="inspector-drawer-trigger"');
    expect(source).toContain('className="inspector-drawer-backdrop"');
    expect(source).toContain(
      'className={`inspector${open ? " is-drawer-open" : ""}`}',
    );
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("aria-expanded={open}");
    expect(styles).toContain(
      "grid-template-columns: var(--shell-nav-width) minmax(0, 1fr);",
    );
    expect(styles).toContain(".inspector {\n  position: fixed;");
    expect(styles).toContain(".inspector.is-drawer-open");
    expect(styles).toContain("display: none;");
    expect(styles).not.toContain(
      "grid-template-columns: 252px minmax(520px, 1fr) 338px;",
    );
  });
});
