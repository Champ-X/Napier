import base from './napier-g01-facts-vitest.config.mts';
export default { ...base, root: '/tmp', resolve:{ alias:[
 {find:'vitest',replacement:'/Users/champ/orca/Napier/node_modules/vitest/dist/index.js'},...base.resolve.alias,
]},test:{...base.test, include:['napier-g01-budget-before.test.ts']} };
