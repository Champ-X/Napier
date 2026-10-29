import base from './napier-g01-facts-vitest.config.mts';
export default { ...base, test: { ...base.test, include: [...base.test.include,
 'packages/runtime/test/plan-archives.test.ts',
 'packages/runtime/test/plan-tools.test.ts',
 'packages/runtime/test/browser-output-artifact.test.ts',
 'packages/runtime/test/workflow-artifact-settlement.test.ts',
 'apps/server/test/plan-artifact-verification.test.ts',
 'apps/server/test/plan-artifact-file-preview-http.test.ts',
 'apps/server/test/plan-progress-http-validation.test.ts',
 'apps/web/test/subagent-primary-view.test.tsx',
] } };
