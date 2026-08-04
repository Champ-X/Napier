import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { ChevronRight, Sparkles } from "lucide-react";

import { copy } from "./copy";
import { ProviderSetupCard } from "./ProviderSetupCard";

export function WelcomePanel({
  canStart,
  onBootstrapUpdated,
  onPrompt,
  threadId,
}: {
  canStart: boolean;
  onBootstrapUpdated: (bootstrap: LiveReadyBootstrapResponse) => void;
  onPrompt: (prompt: string) => void;
  threadId: string | undefined;
}) {
  return (
    <div className="welcome-panel">
      <div className="welcome-seal" aria-hidden="true">
        <Sparkles size={24} />
      </div>
      <span className="eyebrow">{copy.welcome.eyebrow}</span>
      <h2>{copy.welcome.title}</h2>
      <p>{copy.welcome.body}</p>
      <button
        type="button"
        className="prompt-card"
        disabled={!canStart}
        onClick={() => onPrompt(copy.welcome.firstPrompt)}
      >
        <span>01</span>
        <strong>{copy.welcome.firstPrompt}</strong>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      <ProviderSetupCard
        onBootstrapUpdated={onBootstrapUpdated}
        threadId={threadId}
      />
      <div className="principle-row" aria-label="Napier principles">
        <span>LOCAL FIRST</span>
        <span>EVENT SOURCED</span>
        <span>POLICY BOUND</span>
      </div>
    </div>
  );
}

export function shouldShowWelcomePanel(
  messages: readonly { role: string }[],
): boolean {
  return !messages.some((message) => message.role === "user");
}
