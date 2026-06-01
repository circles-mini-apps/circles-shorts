import {
  verifyMessage,
  getAddress,
  isAddress,
  hashMessage,
  createPublicClient,
  http,
} from 'viem';
import { gnosis } from 'viem/chains';

const ERC1271_MAGIC = '0x1626ba7e';

const isValidSignatureAbi = [
  {
    name: 'isValidSignature',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '_hash', type: 'bytes32' },
      { name: '_signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
];

function resolveRpcUrl(envOrUrl) {
  if (typeof envOrUrl === 'string') return envOrUrl;
  return (
    envOrUrl?.CIRCLES_RPC_URL ||
    envOrUrl?.VITE_CIRCLES_RPC_URL ||
    'https://rpc.aboutcircles.com/'
  );
}

/** Verify EOA (EIP-191) or contract wallet (ERC-1271, e.g. Circles Safe). */
export async function verifyWalletSignature(address, message, signature, envOrRpcUrl = {}) {
  if (!address || !message || !signature) return false;
  if (!isAddress(address)) return false;
  const addr = getAddress(address);

  try {
    if (await verifyMessage({ address: addr, message, signature })) return true;
  } catch {
    /* likely a contract wallet */
  }

  const rpcUrl = resolveRpcUrl(envOrRpcUrl);
  const client = createPublicClient({ chain: gnosis, transport: http(rpcUrl) });
  const digest = hashMessage({ message });
  try {
    const result = await client.readContract({
      address: addr,
      abi: isValidSignatureAbi,
      functionName: 'isValidSignature',
      args: [digest, signature],
    });
    return result === ERC1271_MAGIC;
  } catch {
    return false;
  }
}
