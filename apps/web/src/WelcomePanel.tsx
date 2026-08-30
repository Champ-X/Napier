import {
  Blocks,
  Bug,
  FolderSearch2,
  GitCompare,
  ListChecks,
  TestTube2,
} from "lucide-react";

import { copy } from "./copy";

export function WelcomePanel() {
  return (
    <div className="welcome-panel" aria-describedby="welcome-description">
      <h2>{copy.welcome.title}</h2>
      <p id="welcome-description">{copy.welcome.body}</p>
    </div>
  );
}

const STARTERS = [
  { key: "inspect", Icon: FolderSearch2 },
  { key: "build", Icon: Blocks },
  { key: "debug", Icon: Bug },
  { key: "review", Icon: GitCompare },
  { key: "test", Icon: TestTube2 },
  { key: "plan", Icon: ListChecks },
] as const;

export function WelcomeStarterPrompts({
  onSelect,
}: {
  onSelect(prompt: string): void;
}) {
  return (
    <section
      className="welcome-starters"
      aria-labelledby="welcome-starters-title"
    >
      <h3 id="welcome-starters-title">{copy.welcome.cue}</h3>
      <div className="welcome-starter-grid">
        {STARTERS.map(({ key, Icon }) => {
          const starter = copy.welcome.starters[key];
          return (
            <button
              key={key}
              type="button"
              className="welcome-starter"
              data-starter-key={key}
              onClick={() => onSelect(starter.prompt)}
            >
              <span className="welcome-starter-icon" aria-hidden="true">
                <Icon size={17} strokeWidth={1.75} />
              </span>
              <span className="welcome-starter-copy">
                <strong>{starter.title}</strong>
                <small>{starter.body}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function shouldShowWelcomePanel(
  messages: readonly { role: string }[],
): boolean {
  return !messages.some((message) => message.role === "user");
}
