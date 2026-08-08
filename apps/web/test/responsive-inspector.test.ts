import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Responsive Inspector", () => {
  it("keeps the Inspector reachable below desktop width", async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL("../src/ResponsiveInspector.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(source).toContain('className="inspector-drawer-trigger"');
    expect(source).toContain('className="inspector-drawer-backdrop"');
    expect(source).toContain('className={`inspector${open ? " is-drawer-open" : ""}`}');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("aria-expanded={open}");
    expect(styles).toContain("@media (max-width: 1180px)");
    expect(styles).toContain(".inspector.is-drawer-open");
    expect(styles).toContain("transform: translateX(105%)");
    expect(styles).not.toContain(
      '@media (max-width: 1180px) {\n  .app-shell {\n    grid-template-columns: 232px minmax(500px, 1fr);\n  }\n\n  .inspector {\n    display: none;',
    );
  });
});
