import { useEffect, useRef, useState } from "react";
import { FileCheck2, Pause, Play, Upload } from "lucide-react";

import type {
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResultFrame,
} from "@napier/contracts";

import { formatApiErrorMessage } from "./api-error";
import { continueWorkflowBreakpoint } from "./workflow-api";
import { workflowBreakpointCopy as copy } from "./workflow-breakpoint-copy";
import {
  type OpenWorkflowBreakpoint,
  workflowBreakpointManifestMatches,
} from "./workflow-breakpoint-view-model";
import { parseWorkflowManifestText } from "./workflow-experiment-view-model";
import "./workflow-breakpoint.css";

const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface WorkflowBreakpointDeskProps {
  threadId: string;
  breakpoint: OpenWorkflowBreakpoint;
  running: boolean;
  onSettled(): void | Promise<void>;
}

export default function WorkflowBreakpointDesk({
  threadId,
  breakpoint,
  running,
  onSettled,
}: WorkflowBreakpointDeskProps) {
  const [manifest, setManifest] = useState<ExecutionPlanWorkflowManifest>();
  const [manifestFilename, setManifestFilename] = useState("");
  const [result, setResult] = useState<ExecutionPlanWorkflowResultFrame>();
  const [busy, setBusy] = useState<"manifest" | "continue">();
  const [streamedFrameCount, setStreamedFrameCount] = useState(0);
  const [error, setError] = useState<string>();
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const operationGeneration = useRef(0);
  const manifestMatches =
    manifest !== undefined &&
    workflowBreakpointManifestMatches(breakpoint, manifest);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    operationGeneration.current += 1;
    setManifest(undefined);
    setManifestFilename("");
    setResult(undefined);
    setBusy(undefined);
    setStreamedFrameCount(0);
    setError(undefined);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = undefined;
      operationGeneration.current += 1;
    };
  }, [threadId]);

  useEffect(() => {
    setResult(undefined);
    setStreamedFrameCount(0);
    setError(undefined);
    if (manifest && manifest.contentSha256 !== breakpoint.manifestSha256) {
      setManifest(undefined);
      setManifestFilename("");
    }
  }, [breakpoint.reachedEventSeq]);

  const startOperation = (): {
    controller: AbortController;
    generation: number;
  } => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    const generation = operationGeneration.current + 1;
    operationGeneration.current = generation;
    activeRequest.current = controller;
    return { controller, generation };
  };

  const isCurrent = (
    controller: AbortController,
    generation: number,
  ): boolean =>
    !controller.signal.aborted &&
    activeRequest.current === controller &&
    operationGeneration.current === generation;

  const finishOperation = (
    controller: AbortController,
    generation: number,
  ): void => {
    if (!isCurrent(controller, generation)) return;
    activeRequest.current = undefined;
    setBusy(undefined);
  };

  const loadManifest = async (file: File): Promise<void> => {
    if (file.size > MAX_MANIFEST_BYTES) {
      setError(copy.errors.manifestTooLarge);
      return;
    }
    const operation = startOperation();
    setBusy("manifest");
    setError(undefined);
    setResult(undefined);
    try {
      const parsed = await parseWorkflowManifestText(await file.text());
      if (!isCurrent(operation.controller, operation.generation)) return;
      if (!workflowBreakpointManifestMatches(breakpoint, parsed)) {
        setManifest(undefined);
        setManifestFilename("");
        setError(copy.errors.manifestMismatch);
        return;
      }
      setManifest(parsed);
      setManifestFilename(file.name);
    } catch (loadError) {
      if (!isCurrent(operation.controller, operation.generation)) return;
      setManifest(undefined);
      setManifestFilename("");
      setError(
        loadError instanceof Error
          ? loadError.message
          : copy.errors.manifestInvalid,
      );
    } finally {
      finishOperation(operation.controller, operation.generation);
    }
  };

  const continueWorkflow = async (): Promise<void> => {
    if (running) {
      setError(copy.errors.running);
      return;
    }
    if (!manifest || !manifestMatches || busy) return;
    const operation = startOperation();
    setBusy("continue");
    setError(undefined);
    setResult(undefined);
    setStreamedFrameCount(0);
    try {
      const frame = await continueWorkflowBreakpoint(
        threadId,
        manifest,
        breakpoint,
        () => {
          if (isCurrent(operation.controller, operation.generation)) {
            setStreamedFrameCount((count) => count + 1);
          }
        },
        operation.controller.signal,
      );
      if (!isCurrent(operation.controller, operation.generation)) return;
      setResult(frame);
      await onSettled();
    } catch (continueError) {
      if (!isCurrent(operation.controller, operation.generation)) return;
      setError(formatApiErrorMessage(continueError));
      await onSettled();
    } finally {
      finishOperation(operation.controller, operation.generation);
    }
  };

  return (
    <article
      className="workflow-breakpoint-desk"
      aria-labelledby="workflow-breakpoint-title"
      aria-busy={Boolean(busy)}
    >
      <header className="workflow-breakpoint-heading">
        <span className="workflow-breakpoint-seal" aria-hidden="true">
          <Pause size={15} fill="currentColor" />
        </span>
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="workflow-breakpoint-title">{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <strong>
          {String(breakpoint.breakpointIndex + 1).padStart(2, "0")}
          <small>/{String(breakpoint.breakpointCount).padStart(2, "0")}</small>
        </strong>
      </header>

      <dl className="workflow-breakpoint-evidence">
        <Evidence label={copy.node} value={breakpoint.nodeId} />
        <Evidence
          label={copy.planRevision}
          value={`r${String(breakpoint.planRevision)}`}
        />
        <Evidence
          label={copy.reachedSequence}
          value={`#${String(breakpoint.reachedEventSeq)}`}
        />
        <Evidence
          label={copy.binding}
          value={breakpoint.bindingContextSha256.slice(0, 12)}
          title={breakpoint.bindingContextSha256}
        />
        <Evidence
          label={copy.manifestHash}
          value={breakpoint.manifestSha256.slice(0, 12)}
          title={breakpoint.manifestSha256}
        />
      </dl>

      <p className="workflow-breakpoint-note">{copy.waiting}</p>

      <label className="workflow-breakpoint-file">
        <input
          type="file"
          accept="application/json,.json"
          disabled={Boolean(busy)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void loadManifest(file);
          }}
        />
        {manifestMatches ? (
          <FileCheck2 size={14} aria-hidden="true" />
        ) : (
          <Upload size={14} aria-hidden="true" />
        )}
        <span>
          <small>{copy.manifest}</small>
          <strong>
            {busy === "manifest"
              ? copy.loadingManifest
              : manifestFilename ||
                (manifestMatches ? copy.manifestReady : copy.loadManifest)}
          </strong>
        </span>
      </label>

      <button
        type="button"
        className="workflow-breakpoint-continue"
        disabled={!manifestMatches || running || Boolean(busy)}
        onClick={() => void continueWorkflow()}
      >
        <Play size={13} fill="currentColor" aria-hidden="true" />
        {busy === "continue" ? copy.continuing : copy.continue}
      </button>

      {busy === "continue" && streamedFrameCount > 0 ? (
        <span className="workflow-breakpoint-stream">
          {String(streamedFrameCount).padStart(2, "0")} {copy.frames}
        </span>
      ) : null}

      {result ? (
        <div className={`workflow-breakpoint-result state-${result.status}`}>
          <span>{copy.settled}</span>
          <strong>{copy.statuses[result.status]}</strong>
          <small>
            {result.status === "paused" ? copy.nextPause : copy.refreshHint}
          </small>
        </div>
      ) : null}

      {error ? (
        <p className="workflow-breakpoint-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function Evidence({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}
