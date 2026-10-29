import base from './napier-host-accounting-vitest-v6.config.mts';
export default { ...base, root: '/Users/champ/orca/Napier', test: { ...base.test,
 include: [
  'apps/server/test/task-deliverable-facts.test.ts',
  'packages/runtime/test/task-deliverable-inspection.test.ts',
  'apps/web/test/task-validation-matrix.test.ts',
  'apps/web/test/task-narrative-protocol.test.ts',
  'packages/runtime/test/task-outcome-projection.test.ts',
  'packages/runtime/test/kernel-projections.test.ts',
  'apps/web/test/task-narrative-view-model.test.ts',
 ],
} };
