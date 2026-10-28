import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useThreadComposer } from "../src/use-thread-composer";
import {
  ThreadComposerDrafts,
  COMPOSER_DRAFT_PREFIX,
} from "../src/thread-composer-drafts";
import { ComposerDraftNotices } from "../src/ComposerDraftNotices";
import { upsertThreadControlMessage } from "../src/thread-detail-view-state";
import type { ThreadDetail, RunControlMessage } from "@napier/contracts";

let container: HTMLElement;
let workspace = "workspace-a",
  thread: string | undefined = "thread-a";
let vm: ReturnType<typeof useThreadComposer>;
let data: Map<string, string>;
function Harness() {
  vm = useThreadComposer(workspace, thread);
  return <ComposerDraftNotices vm={vm} />;
}
function draw() {
  act(() => render(<Harness />, container));
}
beforeEach(() => {
  const { window, document } = parseHTML(
    "<html><body><div id=app></div></body></html>",
  );
  data = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  container = document.getElementById("app") as unknown as HTMLElement;
  workspace = "workspace-a";
  thread = "thread-a";
  draw();
});
afterEach(() => {
  act(() => render(null, container));
  vi.unstubAllGlobals();
});

it("persists CJK text and mode across unmount, with no attachment bytes in storage", () => {
  act(() => {
    vm.setComposer("保留我未发送的草稿。\n第二行");
    vm.setControlMessageMode("follow_up");
    vm.setComposerImages([
      {
        id: "image",
        name: "private.png",
        size: 3,
        mimeType: "image/png",
        data: "secret-image-bytes",
      },
    ]);
  });
  expect([...data.values()].join()).not.toContain("secret-image-bytes");
  act(() => render(null, container));
  draw();
  expect(vm.composer).toBe("保留我未发送的草稿。\n第二行");
  expect(vm.controlMessageMode).toBe("follow_up");
  expect(vm.composerImages).toEqual([]);
});

it("keeps workspace and thread drafts independent and gives a new thread its own empty draft", () => {
  act(() => vm.setComposer("A draft"));
  thread = "thread-b";
  draw();
  expect(vm.composer).toBe("");
  act(() => vm.setComposer("B draft"));
  workspace = "workspace-b";
  draw();
  expect(vm.composer).toBe("");
  act(() => vm.setComposer("Workspace B draft"));
  workspace = "workspace-a";
  thread = "thread-a";
  draw();
  expect(vm.composer).toBe("A draft");
  thread = "thread-b";
  draw();
  expect(vm.composer).toBe("B draft");
  thread = undefined;
  draw();
  act(() => vm.setComposer("Unowned input"));
  thread = "new-thread";
  draw();
  expect(vm.composer).toBe("");
});

it("restores delayed failures to their source thread without replacing newer input", () => {
  act(() => vm.setComposer("Sent A text"));
  const original = vm;
  act(() => vm.setComposer("Newer A text"));
  thread = "thread-b";
  draw();
  act(() => vm.setComposer("B draft"));
  act(() => original.restoreComposer("Sent A text"));
  expect(vm.composer).toBe("B draft");
  expect(vm.recoveredComposerDrafts).toEqual([]);
  thread = "thread-a";
  draw();
  expect(vm.composer).toBe("Newer A text");
  expect(vm.recoveredComposerDrafts).toEqual(["Sent A text"]);
  act(() => vm.recoverComposerDraft("Sent A text"));
  expect(vm.composer).toBe("Sent A text");
  expect(vm.recoveredComposerDrafts).toEqual(["Newer A text"]);
  act(() => vm.discardRecoveredComposerDraft("Newer A text"));
  expect(vm.recoveredComposerDrafts).toEqual([]);
});

it("drops delayed image reads across A-B-A navigation while retaining text ownership", () => {
  const original = vm;
  act(() =>
    vm.setComposerImages([
      {
        id: "image",
        name: "a.png",
        size: 1,
        mimeType: "image/png",
        data: "YQ==",
      },
    ]),
  );
  thread = "thread-b";
  draw();
  expect(vm.composerImages).toEqual([]);
  thread = "thread-a";
  draw();
  act(() =>
    original.setComposerImages([
      {
        id: "late",
        name: "late.png",
        size: 1,
        mimeType: "image/png",
        data: "YQ==",
      },
    ]),
  );
  expect(vm.composerImages).toEqual([]);
  act(() => original.setComposer((text) => text + "Original thread"));
  expect(vm.composer).toBe("Original thread");
});

it("retains input and shows a persistence warning when browser storage fails", () => {
  window.localStorage.setItem = () => {
    throw new Error("quota exceeded");
  };
  act(() => vm.setComposer("Keep in this window"));
  expect(vm.composer).toBe("Keep in this window");
  expect(vm.composerPersistenceUnavailable).toBe(true);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it("rejects malformed saved data and preserves a recovery draft across reload", () => {
  data.set(COMPOSER_DRAFT_PREFIX + "bad", '{"schemaVersion":1,"text":true}');
  const storage = () => window.localStorage;
  const first = new ThreadComposerDrafts(storage);
  expect(first.read("bad").text).toBe("");
  expect(first.persistenceUnavailable("bad")).toBe(true);
  first.update("valid", (draft) => ({ ...draft, text: "Current" }));
  first.restore("valid", "Old pending input");
  const next = new ThreadComposerDrafts(storage);
  expect(next.read("valid")).toMatchObject({
    text: "Current",
    recovered: ["Old pending input"],
  });
});

it("does not append a response to a different selected thread", () => {
  const detail = {
    thread: { id: "thread-b" },
    runControlMessages: [],
  } as unknown as ThreadDetail;
  const message = {
    id: "control-a",
    threadId: "thread-a",
  } as RunControlMessage;
  expect(upsertThreadControlMessage(detail, message)).toBe(detail);
});
