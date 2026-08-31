import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Eye, File, Folder, RefreshCcw } from "lucide-react";

import {
  listWorkspaceEntries,
  type WorkspaceDirectoryEntry,
  type WorkspaceDirectoryListing,
} from "./workspace-directory-api";
import { workspaceEvidenceCopy as t } from "./workspace-evidence-copy";

export interface WorkspaceFileTreeProps {
  workspaceRoot: string;
  openablePaths: readonly string[];
  onOpenFile(path: string): void;
}

export function WorkspaceFileTree({
  workspaceRoot,
  openablePaths,
  onOpenFile,
}: WorkspaceFileTreeProps) {
  const [listings, setListings] = useState<
    Record<string, WorkspaceDirectoryListing>
  >({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const currentRootRef = useRef(workspaceRoot);
  const requestGenerationRef = useRef(0);
  currentRootRef.current = workspaceRoot;
  const openableByNormalizedPath = useMemo(
    () =>
      new Map(
        openablePaths.map((path) => [normalizePath(path), path] as const),
      ),
    [openablePaths],
  );

  const loadDirectory = useCallback(
    async (
      directory: string,
      cursor?: string,
      generation = requestGenerationRef.current,
    ) => {
      setLoading((current) => withSetValue(current, directory, true));
      setErrors((current) => withoutKey(current, directory));
      try {
        const listing = await listWorkspaceEntries(directory, cursor);
        if (
          currentRootRef.current !== workspaceRoot ||
          generation !== requestGenerationRef.current
        ) {
          return;
        }
        setListings((current) => ({
          ...current,
          [directory]: cursor
            ? mergeListings(current[directory], listing)
            : listing,
        }));
      } catch (error) {
        if (
          currentRootRef.current !== workspaceRoot ||
          generation !== requestGenerationRef.current
        ) {
          return;
        }
        setErrors((current) => ({
          ...current,
          [directory]: error instanceof Error ? error.message : t.fileTreeError,
        }));
      } finally {
        if (
          currentRootRef.current === workspaceRoot &&
          generation === requestGenerationRef.current
        ) {
          setLoading((current) => withSetValue(current, directory, false));
        }
      }
    },
    [workspaceRoot],
  );

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setListings({});
    setErrors({});
    setLoading(new Set());
    setExpanded(new Set());
    void loadDirectory(workspaceRoot, undefined, generation);
  }, [loadDirectory, workspaceRoot]);

  const toggleDirectory = (directory: string) => {
    const willExpand = !expanded.has(directory);
    setExpanded((current) => withSetValue(current, directory, willExpand));
    if (willExpand && !listings[directory] && !loading.has(directory)) {
      void loadDirectory(directory);
    }
  };

  const refresh = () => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setListings({});
    setErrors({});
    setLoading(new Set());
    setExpanded(new Set());
    void loadDirectory(workspaceRoot, undefined, generation);
  };

  const openableTarget = (entry: WorkspaceDirectoryEntry) => {
    const absolute = normalizePath(entry.path);
    const root = normalizePath(workspaceRoot).replace(/\/$/u, "");
    const relative = absolute.startsWith(`${root}/`)
      ? absolute.slice(root.length + 1)
      : absolute;
    return (
      openableByNormalizedPath.get(relative) ??
      openableByNormalizedPath.get(absolute)
    );
  };

  const renderDirectory = (
    directory: string,
    depth: number,
  ): React.ReactNode => {
    const listing = listings[directory];
    if (!listing) {
      if (loading.has(directory)) {
        return (
          <li
            className="workspace-file-tree-state"
            role="status"
            aria-live="polite"
          >
            {t.loadingFiles}
          </li>
        );
      }
      if (errors[directory]) {
        return (
          <li className="workspace-file-tree-state is-error" role="alert">
            <span>{t.fileTreeError}</span>
            <button type="button" onClick={() => void loadDirectory(directory)}>
              {t.retryFiles}
            </button>
          </li>
        );
      }
      return null;
    }
    if (listing.entries.length === 0) {
      return <li className="workspace-file-tree-state">{t.emptyFolder}</li>;
    }
    return (
      <>
        {listing.entries.map((entry) => {
          const isDirectory = entry.kind === "directory";
          const isExpanded = isDirectory && expanded.has(entry.path);
          const isRecordedOutput =
            !isDirectory && Boolean(openableTarget(entry));
          return (
            <li key={entry.path}>
              {isDirectory ? (
                <button
                  type="button"
                  className="workspace-file-tree-row is-directory"
                  style={{ paddingInlineStart: `${String(depth * 14 + 5)}px` }}
                  aria-expanded={isExpanded}
                  title={entry.path}
                  onClick={() => toggleDirectory(entry.path)}
                >
                  <ChevronRight size={13} aria-hidden="true" />
                  <Folder size={14} aria-hidden="true" />
                  <span>{entry.name}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className={`workspace-file-tree-row is-file is-openable${isRecordedOutput ? " is-recorded-output" : ""}`}
                  style={{ paddingInlineStart: `${String(depth * 14 + 18)}px` }}
                  title={`${t.previewFile}: ${entry.path}`}
                  aria-label={`${t.previewFile}: ${entry.name}`}
                  onClick={() => onOpenFile(entry.path)}
                >
                  <File size={13} aria-hidden="true" />
                  <span>{entry.name}</span>
                  <Eye size={12} aria-hidden="true" />
                </button>
              )}
              {isDirectory && isExpanded ? (
                <ul>{renderDirectory(entry.path, depth + 1)}</ul>
              ) : null}
            </li>
          );
        })}
        {errors[directory] ? (
          <li className="workspace-file-tree-state is-error" role="alert">
            <span>{t.fileTreeError}</span>
            <button
              type="button"
              onClick={() =>
                void loadDirectory(directory, listing.nextCursor ?? undefined)
              }
            >
              {t.retryFiles}
            </button>
          </li>
        ) : listing.nextCursor ? (
          <li className="workspace-file-tree-state">
            <button
              type="button"
              disabled={loading.has(directory)}
              onClick={() =>
                void loadDirectory(directory, listing.nextCursor ?? undefined)
              }
            >
              {loading.has(directory) ? t.loadingMoreFiles : t.loadMoreFiles}
            </button>
          </li>
        ) : null}
      </>
    );
  };

  return (
    <section
      className="workspace-file-tree"
      aria-label={t.files}
      aria-busy={loading.size > 0}
    >
      <div className="workspace-file-tree-root">
        <span className="workspace-file-tree-label">{t.files}</span>
        <button
          type="button"
          className="workspace-file-tree-refresh"
          aria-label={t.refreshFiles}
          title={t.refreshFiles}
          onClick={refresh}
        >
          <RefreshCcw size={12} aria-hidden="true" />
        </button>
      </div>
      <ul>{renderDirectory(workspaceRoot, 0)}</ul>
    </section>
  );
}

function withSetValue(
  current: ReadonlySet<string>,
  value: string,
  present: boolean,
): ReadonlySet<string> {
  const next = new Set(current);
  if (present) next.add(value);
  else next.delete(value);
  return next;
}

function withoutKey(
  current: Record<string, string>,
  key: string,
): Record<string, string> {
  const { [key]: _removed, ...rest } = current;
  return rest;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function mergeListings(
  current: WorkspaceDirectoryListing | undefined,
  next: WorkspaceDirectoryListing,
): WorkspaceDirectoryListing {
  if (!current || current.path !== next.path) return next;
  const entries = new Map(
    [...current.entries, ...next.entries].map((entry) => [entry.path, entry]),
  );
  return { ...next, entries: [...entries.values()] };
}
