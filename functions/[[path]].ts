import worker from '../worker/index.js';
export const onRequest = (context: {request: Request; env: Record<string, unknown>}) => worker.fetch(context.request, context.env);
