import {settleJob} from './job-result.mjs';

export async function runJobs(jobs, options = {}) {
  if (!Array.isArray(jobs)) {
    throw new TypeError('jobs must be an array');
  }
  for (const job of jobs) {
    if (typeof job !== 'function') {
      throw new TypeError('every job must be a function');
    }
  }

  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const concurrency = options.concurrency === undefined ? 2 : options.concurrency;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new TypeError('concurrency must be an integer between 1 and 32');
  }
  const signal = options.signal;
  if (signal !== undefined && signal !== null) {
    if (typeof AbortSignal !== 'undefined' && signal instanceof AbortSignal) {
      // accepted
    } else if (
      typeof signal !== 'object' ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function'
    ) {
      throw new TypeError('signal must be an AbortSignal');
    }
  }

  const results = new Array(jobs.length);
  let nextIndex = 0;

  // Snapshot abort state without registering a listener: attaching one would
  // keep the signal alive and could exceed listener limits on repeated runs.
  const aborted = () => signal !== undefined && signal !== null && signal.aborted === true;

  async function worker() {
    while (nextIndex < jobs.length) {
      if (aborted()) {
        while (nextIndex < jobs.length) {
          results[nextIndex] = {status: 'cancelled'};
          nextIndex += 1;
        }
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      const job = jobs[index];
      // Every started job settles with its actual outcome, even if an abort
      // happens while it is in flight.
      results[index] = await settleJob(job);
    }
  }

  const workerCount = Math.min(concurrency, jobs.length);
  const workers = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

