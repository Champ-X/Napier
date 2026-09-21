import {normalizeGraph} from './graph.mjs';
export function planRollout(nodes,{selected=null,maxParallel=2}={}){
 const g=normalizeGraph(nodes);if(!Number.isInteger(maxParallel)||maxParallel<1||maxParallel>100||!(selected===null||(Array.isArray(selected)&&new Set(selected).size===selected.length&&selected.every(id=>g.has(id)))))throw new TypeError('Invalid selection');
 const remaining=new Set(),todo=[...(selected??g.keys())];while(todo.length){const id=todo.pop();if(remaining.has(id))continue;remaining.add(id);todo.push(...g.get(id));}
 const waves=[],done=new Set();while(remaining.size){const wave=[...remaining].filter(id=>g.get(id).every(d=>done.has(d))).sort().slice(0,maxParallel);waves.push(wave);for(const id of wave){remaining.delete(id);done.add(id);}}return waves;
}
