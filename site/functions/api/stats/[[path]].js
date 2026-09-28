import { handleStats } from '../../../server/stats.js';
export const onRequest = context => handleStats(context.request, context.env, context);
