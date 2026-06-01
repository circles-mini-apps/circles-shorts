import {
  handleIpfsPinRequest,
  handleIpfsUnpinRequest,
  handleIpfsPinListRequest,
} from './ipfsApiHandlers.js';

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function toWebRequest(req, url) {
  const method = req.method || 'GET';
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const raw = await readRequestBody(req);
    body = raw || undefined;
  }
  return new Request(`http://localhost${url}`, { method, body });
}

async function sendWebResponse(webRes, res) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const text = await webRes.text();
  res.end(text);
}

/** Vite dev server middleware for /api/ipfs/* (mirrors Cloudflare Functions). */
export function createDevIpfsMiddleware(env) {
  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/ipfs/')) return next();

    try {
      const webReq = await toWebRequest(req, req.url);
      let webRes;
      if (path === '/api/ipfs/pin') {
        webRes = await handleIpfsPinRequest(webReq, env);
      } else if (path === '/api/ipfs/unpin') {
        webRes = await handleIpfsUnpinRequest(webReq, env);
      } else if (path === '/api/ipfs/pin-list') {
        webRes = await handleIpfsPinListRequest(webReq, env);
      } else {
        return next();
      }
      await sendWebResponse(webRes, res);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message || 'IPFS API error' }));
    }
  };
}
