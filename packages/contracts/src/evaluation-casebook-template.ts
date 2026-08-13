export interface EvaluationCasebookTemplateCase {
  id: string;
  title: string;
  description: string;
  taskPrompt: string;
  acceptanceCriteria: string[];
  critical: boolean;
}

export interface EvaluationCasebookTemplate {
  id: string;
  version: number;
  name: string;
  description: string;
  cases: EvaluationCasebookTemplateCase[];
}
