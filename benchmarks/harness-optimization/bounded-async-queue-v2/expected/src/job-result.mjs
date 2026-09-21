export async function settleJob(job){
 if(typeof job!=='function')throw new TypeError('Job must be a function');
 try{return {status:'fulfilled',value:await job()};}catch(reason){return {status:'rejected',reason};}
}
