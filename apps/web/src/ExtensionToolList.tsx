import { useState } from "react";

import type { ExtensionRecord } from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";

export interface ExtensionToolListProps {
  extension: ExtensionRecord;
  busy: boolean;
  onToolReview(
    extensionId: string,
    toolName: string,
    action: "approve" | "reject",
    effect?: "read" | "write",
    routingHint?: string,
  ): void;
}

export function ExtensionToolList({
  extension,
  busy,
  onToolReview,
}: ExtensionToolListProps) {
  const [routingHints, setRoutingHints] = useState<Record<string, string>>({});
  return (
    <>
      {extension.tools.length > 0 ? (
        <section className="extension-tools" aria-label={copy.tools}>
          <header>
            <h3>{copy.tools}</h3>
            <span>{String(extension.tools.length).padStart(2, "0")}</span>
          </header>
          {extension.tools.map((tool) => (
            <article className="extension-tool" key={tool.name}>
              <header>
                <div>
                  <strong>{tool.name}</strong>
                  <code>{tool.directName}</code>
                </div>
                <span>{copy.statuses[tool.reviewStatus]}</span>
              </header>
              {tool.description ? <p>{tool.description}</p> : null}
              <label className="extension-routing-hint">
                <span>{copy.routingHint}</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={routingHints[tool.name] ?? tool.routingHint ?? ""}
                  placeholder={copy.routingHintPlaceholder}
                  disabled={busy}
                  onChange={(event) =>
                    setRoutingHints((current) => ({
                      ...current,
                      [tool.name]: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="extension-tool-meta">
                <span>
                  {copy.effect}:{" "}
                  {tool.effect === "unknown"
                    ? copy.unknown
                    : tool.effect === "read"
                      ? copy.read
                      : copy.write}
                </span>
                <span>
                  {copy.schema} {tool.schemaSha256.slice(0, 8)}
                </span>
              </div>
              <footer>
                {tool.reviewStatus === "approved" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onToolReview(extension.id, tool.name, "reject")
                    }
                  >
                    {copy.revoke}
                  </button>
                ) : (
                  <>
                    {extension.approvedCapabilities.includes(
                      "external.read",
                    ) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          onToolReview(
                            extension.id,
                            tool.name,
                            "approve",
                            "read",
                            routingHints[tool.name] ?? tool.routingHint ?? "",
                          )
                        }
                      >
                        {copy.approveRead}
                      </button>
                    ) : null}
                    {extension.approvedCapabilities.includes(
                      "external.write",
                    ) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          onToolReview(
                            extension.id,
                            tool.name,
                            "approve",
                            "write",
                            routingHints[tool.name] ?? tool.routingHint ?? "",
                          )
                        }
                      >
                        {copy.approveWrite}
                      </button>
                    ) : null}
                    {tool.reviewStatus === "pending" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          onToolReview(extension.id, tool.name, "reject")
                        }
                      >
                        {copy.reject}
                      </button>
                    ) : null}
                  </>
                )}
              </footer>
            </article>
          ))}
        </section>
      ) : extension.trustStatus === "approved" ? (
        <p className="extension-no-tools">{copy.noTools}</p>
      ) : null}
    </>
  );
}
