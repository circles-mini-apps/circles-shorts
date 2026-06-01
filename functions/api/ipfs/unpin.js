import { handleIpfsUnpinRequest } from '../../../lib/ipfsApiHandlers.js';

export async function onRequest(context) {
  return handleIpfsUnpinRequest(context.request, context.env);
}

export async function onRequestOptions(context) {
  return handleIpfsUnpinRequest(context.request, context.env);
}
