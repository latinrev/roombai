import { handle } from '../../../server/sponsors.js';
export const onRequest = ({ request, env }) => handle(request, env);
