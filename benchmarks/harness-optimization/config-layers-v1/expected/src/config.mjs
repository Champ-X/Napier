import {mergeConfig} from './merge.mjs';
export function resolveConfig(defaults,fileLayers=[],environment={},overrides={}){
 const env={};
 if(environment.APP_PORT!==undefined){const s=environment.APP_PORT;if(typeof s!=='string'||!/^\d+$/.test(s)||Number(s)>65535)throw new TypeError('Invalid port');env.server={port:Number(s)};}
 if(environment.APP_DEBUG!==undefined){if(!['true','false'].includes(environment.APP_DEBUG))throw new TypeError('Invalid debug');env.debug=environment.APP_DEBUG==='true';}
 if(environment.APP_TAGS!==undefined){if(typeof environment.APP_TAGS!=='string')throw new TypeError('Invalid tags');env.tags=environment.APP_TAGS.split(',').map(x=>x.trim()).filter(Boolean);}
 return [...fileLayers,env,overrides].reduce(mergeConfig,mergeConfig({},defaults));
}
