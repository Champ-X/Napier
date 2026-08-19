import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  BrowserTakeoverAction,
  BrowserTakeoverActionReceipt,
  BrowserTakeoverSnapshot,
} from "@napier/contracts/browser-takeover";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";

import { formatApiErrorMessage } from "./api-error";
import { getBrowserTakeoverSnapshot } from "./browser-takeover-api";
import { browserViewportCoordinates } from "./browser-takeover-visual";
import type {
  BrowserTakeoverBinding,
  BrowserTakeoverExecute,
  BrowserTakeoverFormState,
} from "./browser-takeover-view";
import { useBrowserTakeoverExecution } from "./use-browser-takeover-execution";

const INITIAL_FORM: BrowserTakeoverFormState = {
  mode: "click",
  ref: "",
  value: "",
  newTabUrl: "",
  selectedKey: "Enter",
  allowCrossOrigin: false,
};

export interface BrowserTakeoverDeskController {
  snapshot: BrowserTakeoverSnapshot | undefined;
  receipt: BrowserTakeoverActionReceipt | undefined;
  form: BrowserTakeoverFormState;
  busy: boolean;
  error: string | undefined;
  binding: BrowserTakeoverBinding | undefined;
  execute: BrowserTakeoverExecute;
  refresh: () => Promise<void>;
  updateForm: (patch: Partial<BrowserTakeoverFormState>) => void;
  submitTargetAction: () => void;
  openTab: () => void;
  visualClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function useBrowserTakeoverDesk(
  threadId: string,
  runId: string,
  liveReceipt: BrowserLiveViewReceipt,
  onActivityChange: (action: BrowserTakeoverAction | undefined) => void,
): BrowserTakeoverDeskController {
  const [snapshot, setSnapshot] = useState<BrowserTakeoverSnapshot>();
  const [receipt, setReceipt] = useState<BrowserTakeoverActionReceipt>();
  const [form, setForm] = useState(INITIAL_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(await getBrowserTakeoverSnapshot(threadId, runId));
    } catch (refreshError) {
      setSnapshot(undefined);
      setError(formatApiErrorMessage(refreshError));
    } finally {
      setBusy(false);
    }
  }, [runId, threadId]);
  useEffect(() => void refresh(), [refresh]);
  const binding = useMemo(() => snapshotBinding(snapshot), [snapshot]);
  const execute = useBrowserTakeoverExecution({
    threadId,
    runId,
    onActivityChange,
    setBusy,
    setError,
    setReceipt,
    setSnapshot,
    clearPrivateState: () =>
      setForm((current) => ({
        ...current,
        ref: "",
        value: "",
        newTabUrl: "",
        allowCrossOrigin: false,
      })),
  });
  const actions = useBrowserTakeoverActions(
    binding,
    form,
    liveReceipt,
    execute,
  );
  return {
    snapshot,
    receipt,
    form,
    busy,
    error,
    binding,
    execute,
    refresh,
    updateForm: (patch) => setForm((current) => ({ ...current, ...patch })),
    ...actions,
  };
}

function useBrowserTakeoverActions(
  binding: BrowserTakeoverBinding | undefined,
  form: BrowserTakeoverFormState,
  liveReceipt: BrowserLiveViewReceipt,
  execute: BrowserTakeoverExecute,
) {
  const submitTargetAction = useCallback(() => {
    if (!binding || !form.ref.trim()) return;
    const ref = form.ref.trim().toLowerCase();
    if (form.mode === "click") {
      void execute({
        ...binding,
        action: "click",
        ref,
        ...(form.allowCrossOrigin ? { allowCrossOrigin: true } : {}),
      });
      return;
    }
    if (form.mode === "type") {
      void execute({ ...binding, action: "type", ref, text: form.value });
      return;
    }
    const values = form.value
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length > 0)
      void execute({ ...binding, action: "select", ref, values });
  }, [binding, execute, form]);
  const openTab = useCallback(() => {
    if (!binding || !form.newTabUrl.trim()) return;
    void execute({
      ...binding,
      action: "tab_new",
      url: form.newTabUrl.trim(),
      ...(form.allowCrossOrigin ? { allowCrossOrigin: true } : {}),
    });
  }, [binding, execute, form.allowCrossOrigin, form.newTabUrl]);
  const visualClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!binding) return;
      const image = event.currentTarget.querySelector("img");
      if (!image) return;
      const point = browserViewportCoordinates(
        event.clientX,
        event.clientY,
        image.getBoundingClientRect(),
        liveReceipt,
      );
      if (!point) return;
      void execute({
        ...binding,
        action: "visual_click",
        expectedLiveImageSha256: liveReceipt.imageSha256,
        expectedViewportWidth: liveReceipt.viewportWidth,
        expectedViewportHeight: liveReceipt.viewportHeight,
        ...point,
        ...(form.allowCrossOrigin ? { allowCrossOrigin: true } : {}),
      });
    },
    [binding, execute, form.allowCrossOrigin, liveReceipt],
  );
  return { submitTargetAction, openTab, visualClick };
}

function snapshotBinding(
  snapshot: BrowserTakeoverSnapshot | undefined,
): BrowserTakeoverBinding | undefined {
  return snapshot
    ? {
        expectedPauseStateSha256: snapshot.pauseStateSha256,
        expectedSessionIdSha256: snapshot.sessionIdSha256,
        expectedSessionOperation: snapshot.sessionOperation,
        expectedSnapshotSha256: snapshot.snapshotSha256,
        expectedActiveTabId: snapshot.activeTabId,
        expectedTabCount: snapshot.tabCount,
        expectedTabSetSha256: snapshot.tabSetSha256,
      }
    : undefined;
}
