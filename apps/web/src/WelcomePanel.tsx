import { Sparkles } from "lucide-react";

import { copy } from "./copy";

export function WelcomePanel() {
  return (
    <div className="welcome-panel">
      <div className="welcome-seal" aria-hidden="true">
        <Sparkles size={24} />
      </div>
      <span className="eyebrow">{copy.welcome.eyebrow}</span>
      <h2>{copy.welcome.title}</h2>
      <p>{copy.welcome.body}</p>
      <span className="welcome-cue">{copy.welcome.cue}</span>
    </div>
  );
}

export function shouldShowWelcomePanel(
  messages: readonly { role: string }[],
): boolean {
  return !messages.some((message) => message.role === "user");
}
