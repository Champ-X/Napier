import { ArrowDown } from "lucide-react";

import { advancedSurfaceCopy } from "./advanced-surface-copy";
import "./conversation-follow.css";

export interface ConversationFollowButtonProps {
  /** True once auto-follow paused because the reader scrolled up. */
  paused: boolean;
  /** Items that arrived while following was paused. */
  pendingCount: number;
  /** Scrolls to the newest item and resumes following. */
  onJump(): void;
}

export function ConversationFollowButton({
  paused,
  pendingCount,
  onJump,
}: ConversationFollowButtonProps) {
  if (!paused) return null;
  const follow = advancedSurfaceCopy.conversationFollow;
  const label =
    pendingCount > 0
      ? `${follow.newActivity} · ${String(pendingCount)}`
      : follow.resume;
  return (
    <div className="conversation-follow" role="status" aria-live="polite">
      <button
        type="button"
        className="conversation-follow-button"
        aria-label={label}
        title={label}
        onClick={onJump}
      >
        <ArrowDown size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
