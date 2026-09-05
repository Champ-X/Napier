import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Content axis contract (design §7.3): conversation messages, the composer, and
 * the empty state share a single main-column width expression, and the shell
 * reserves the composer's live measured height beneath the scroll surface
 * (design §7.1). These are asserted at the source level so a feature cannot
 * silently redefine the main column or hard-code a composer height again.
 */
describe("Content axis", () => {
  it("routes conversation and composer widths through one shared axis token", async () => {
    const [globals, conversation] = await Promise.all([
      readFile(new URL("../src/styles/global.css", import.meta.url), "utf8"),
      readFile(
        new URL("../src/styles/conversation.css", import.meta.url),
        "utf8",
      ),
    ]);

    expect(globals).toContain("--content-axis:");
    expect(globals).toContain("var(--layout-reading-max)");

    // Both the message feed and the composer resolve from the shared axis
    // instead of repeating the min(reading-max, ...) expression.
    expect(conversation).toContain("width: var(--content-axis)");
    expect(
      conversation.match(/width: var\(--content-axis\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(conversation).not.toContain(
      "width: min(var(--layout-reading-max), calc(100% - var(--space-12)))",
    );
  });

  it("caps user messages at 82% of the axis and keeps assistant results bubble-free", async () => {
    const conversation = await readFile(
      new URL("../src/styles/conversation.css", import.meta.url),
      "utf8",
    );

    expect(conversation).toContain(".role-user .message-content");
    expect(conversation).toContain("max-width: 82%");
    expect(conversation).toContain("margin-left: auto");
  });

  it("keeps intrinsic user bubbles independent from markdown preview containment", async () => {
    const [conversation, markdown] = await Promise.all([
      readFile(
        new URL("../src/styles/arena-conversation.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/message-markdown.css", import.meta.url), "utf8"),
    ]);

    expect(conversation).toContain("width: fit-content");
    expect(markdown).not.toMatch(/\.message-text\s*\{[^}]*container-type:/u);
    expect(markdown).toMatch(
      /\.message-html-preview\s*\{[^}]*container-type: inline-size;/u,
    );
    expect(markdown).toContain("overflow-wrap: anywhere");
  });

  it("keeps copy actions reachable and assistant copy actions persistent", async () => {
    const [conversation, arena, cards] = await Promise.all([
      readFile(
        new URL("../src/styles/conversation.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/styles/arena-conversation.css", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/ConversationMessageCards.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(cards).toContain("message-card has-copy-action role-");
    expect(arena).toMatch(
      /\.message-card\.has-copy-action\s*\{[^}]*padding-block-end: calc\(var\(--control-target\) \+ var\(--space-1\)\);/u,
    );
    expect(conversation).toContain(
      ".message-card:focus-within .message-copy-action",
    );
    expect(conversation).toContain(".role-assistant .message-copy-action");
  });

  it("reserves the live composer height under the conversation scroll surface", async () => {
    const [globals, taskWorkbench, composer, hook] = await Promise.all([
      readFile(new URL("../src/styles/global.css", import.meta.url), "utf8"),
      readFile(
        new URL("../src/styles/task-workbench.css", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/Composer.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/use-composer-height.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(globals).toContain("--composer-height:");
    expect(taskWorkbench).toContain(
      "scroll-padding-block-end: var(--composer-height)",
    );
    // Composer publishes its measured height through the hook.
    expect(composer).toContain("useComposerHeight(composerRef)");
    expect(composer).toContain("ref={composerRef}");
    expect(hook).toContain('closest<HTMLElement>(".app-shell")');
    expect(hook).toContain("ResizeObserver");
    expect(hook).toContain("setProperty(COMPOSER_HEIGHT_PROPERTY");
  });
});
