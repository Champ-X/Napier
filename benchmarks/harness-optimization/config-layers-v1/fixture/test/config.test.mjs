import {test} from 'node:test'; import assert from 'node:assert/strict';
import {resolveConfig} from '../src/config.mjs';
test('layer and environment precedence',()=>{
 const base={server:{host:'local',port:8080},debug:true,tags:['base']};
 assert.deepEqual(resolveConfig(base,[{server:{port:7000}}],{APP_DEBUG:'false',APP_PORT:'0',APP_TAGS:''},{tags:['override']}),{server:{host:'local',port:0},debug:false,tags:['override']});
 assert.equal(base.server.port,8080);
});
