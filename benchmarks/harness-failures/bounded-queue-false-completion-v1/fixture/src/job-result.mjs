export async function settleJob(job){return {status:'fulfilled',value:await job()};}
