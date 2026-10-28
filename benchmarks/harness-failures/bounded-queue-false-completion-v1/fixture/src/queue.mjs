import {settleJob} from './job-result.mjs';export async function runJobs(jobs,options={}){return Promise.all(jobs.map(settleJob));}
