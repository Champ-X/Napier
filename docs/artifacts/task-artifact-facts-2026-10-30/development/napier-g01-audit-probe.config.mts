import base from './napier-host-accounting-vitest-v6.config.mts';
export default { ...base, root: '/tmp', resolve: { alias: [
  { find: 'vitest', replacement: '/Users/champ/orca/Napier/node_modules/vitest/dist/index.js' },
  ...base.resolve.alias,
] }, test: { ...base.test, include: ['napier-g01-audit-probe.test.ts'] } };
