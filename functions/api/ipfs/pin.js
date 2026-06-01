import { handleIpfsPinRequest } from '../../../lib/ipfsApiHandlers.js';

export async function onRequest(context) {
  return handleIpfsPinRequest(context.request, context.env);
}

export async function onRequestOptions(context) {
  return handleIpfsPinRequest(context.request, context.env);
}
