import {parseRetryAfter} from './retry-after.mjs';
export function retryDelay(o){if(o.status<500||o.attempt>=3)return null;return parseRetryAfter(o.retryAfter,o.nowMs)||100*2**o.attempt;}
