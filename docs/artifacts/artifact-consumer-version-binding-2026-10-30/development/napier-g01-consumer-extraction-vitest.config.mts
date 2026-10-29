import base from './napier-g01-consumer-vitest.config.mts';
export default {...base, test: {...base.test, include: ['apps/web/test/message-workspace-links.test.tsx', 'apps/web/test/message-markdown.test.ts']}};
