import { ProcessPanelView } from "./ProcessPanelView";
import { useProcessPanel } from "./use-process-panel";

export interface ProcessPanelProps {
  threadId: string;
  onThreadChanged(): void | Promise<void>;
}

export default function ProcessPanel(props: ProcessPanelProps) {
  return <ProcessPanelView state={useProcessPanel(props)} />;
}
