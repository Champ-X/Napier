import { useEffect, useState } from "react";

import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";

import {
  getAgentProfileRevisions,
  rollbackAgentProfileRevision,
} from "./context-api";
import { toErrorMessage } from "./context-panel-helpers";

export interface ContextAgentRevisionControllerInput {
  agent: AgentProfile;
  threadId: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string | undefined) => void;
  onModel: (modelKey: string) => void;
  onAgentUpdated: (agent: AgentProfile) => void;
}

export function useContextAgentRevisionController({
  agent,
  threadId,
  busy,
  onBusy,
  onError,
  onModel,
  onAgentUpdated,
}: ContextAgentRevisionControllerInput) {
  const [agentRevisions, setAgentRevisions] = useState<AgentProfileRevision[]>(
    [],
  );
  const [historyLoading, setHistoryLoading] = useState(true);
  const [rollbackTarget, setRollbackTarget] = useState<AgentProfileRevision>();

  useEffect(() => {
    setRollbackTarget(undefined);
  }, [agent.id, agent.revision]);

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    void getAgentProfileRevisions(agent.id)
      .then((revisions) => {
        if (active) setAgentRevisions(revisions);
      })
      .catch((error: unknown) => {
        if (active) onError(toErrorMessage(error));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agent.id, agent.revision]);

  const confirmRollback = async (): Promise<void> => {
    if (!rollbackTarget || busy) return;
    onBusy(true);
    onError(undefined);
    try {
      const result = await rollbackAgentProfileRevision(agent.id, {
        revision: rollbackTarget.revision,
        threadId,
      });
      onModel(`${result.agent.model.provider}/${result.agent.model.id}`);
      onAgentUpdated(result.agent);
      setAgentRevisions(await getAgentProfileRevisions(agent.id));
      setRollbackTarget(undefined);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      onBusy(false);
    }
  };

  return {
    agentRevisions,
    historyLoading,
    rollbackTarget,
    setRollbackTarget,
    confirmRollback,
  };
}
