import { ShieldCheck } from "lucide-react";

import type {
  CreateMcpExtensionRequest,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
} from "@napier/contracts";
import type { KernelPluginInspection } from "@napier/contracts/kernel-plugins";

import { extensionCopy as copy } from "./extension-copy";
import { ExtensionCard } from "./ExtensionCard";
import { ExtensionProposalForm } from "./ExtensionProposalForm";
import KernelPluginDesk from "./KernelPluginDesk";

type Proposal = Omit<CreateMcpExtensionRequest, "threadId">;

export interface ExtensionPanelProps {
  extensions: ExtensionRecord[];
  plugins: KernelPluginInspection[];
  publisherAnchors: ExtensionPublisherTrustAnchor[];
  agentId: string;
  busyId: string | undefined;
  onPropose: (request: Proposal) => Promise<void>;
  onReview: (extensionId: string, action: "approve" | "reject") => void;
  onConnect: (extensionId: string) => void;
  onDisconnect: (extensionId: string) => void;
  onToolReview: (
    extensionId: string,
    toolName: string,
    action: "approve" | "reject",
    effect?: "read" | "write",
    routingHint?: string,
  ) => void;
  onToggle: (extensionId: string, enabled: boolean) => void;
}

export default function ExtensionPanel({
  extensions,
  plugins,
  publisherAnchors,
  agentId,
  busyId,
  onPropose,
  onReview,
  onConnect,
  onDisconnect,
  onToolReview,
  onToggle,
}: ExtensionPanelProps) {
  const activeTools = extensions.reduce(
    (count, extension) =>
      count +
      extension.tools.filter((tool) => tool.reviewStatus === "approved").length,
    0,
  );
  return (
    <section
      className="panel-section extensions-panel"
      aria-labelledby="extensions-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.eyebrow}</span>
          <h2 id="extensions-title">{copy.title}</h2>
        </div>
        <span className="extension-count">
          {activeTools} {copy.activeTools}
        </span>
      </div>

      <KernelPluginDesk plugins={plugins} />

      <ExtensionProposalForm busyId={busyId} onPropose={onPropose} />

      {extensions.length === 0 ? (
        <p className="empty-panel">{copy.empty}</p>
      ) : null}
      <div className="extension-list">
        {extensions.map((extension) => (
          <ExtensionCard
            key={extension.id}
            extension={extension}
            publisherAnchors={publisherAnchors}
            agentId={agentId}
            busy={busyId === extension.id}
            onReview={onReview}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onToolReview={onToolReview}
            onToggle={onToggle}
          />
        ))}
      </div>
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.safety}
      </p>
    </section>
  );
}
