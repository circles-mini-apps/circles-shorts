import { handleIpfsPinListRequest } from '../../../lib/ipfsApiHandlers.js';

export async function onRequest(context) {
  return handleIpfsPinListRequest(context.request, context.env);
}

export async function onRequestOptions(context) {
  return handleIpfsPinListRequest(context.request, context.env);
}
