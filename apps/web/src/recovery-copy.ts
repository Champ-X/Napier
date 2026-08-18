export const recoveryCopy = {
  eyebrow: "RECOVERY CHECKPOINT",
  title: "A run stopped before settlement.",
  body: "Resume from durable evidence. Napier will verify current state before repeating any operation with possible side effects.",
  action: "Resume safely",
  run: "Interrupted run",
  partial: {
    eyebrow: "PARTIAL CHECKPOINT",
    title: "This task has preserved partial work.",
    body: "Continue this task from its durable plan, evidence, and artifacts. A normal message starts a new run instead.",
    action: "Continue this task",
    run: "Partial run",
  },
};
