import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

const rpcUrl = import.meta.env.VITE_CIRCLES_RPC_URL;

/** Optional read client; host iframe may still require RPC from `onAppData`. */
export function createChainClient(url = rpcUrl) {
  if (!url) return null;
  return createPublicClient({
    chain: gnosis,
    transport: http(url),
  });
}

export const publicClient = createChainClient();
