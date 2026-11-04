export type NetworkRef = {
  hash: string;
  blockNumber: string | null;
  from: string | null;
  to: string | null;
  valueWei: string | null;
  source: 'testnet-rpc';
};

export type JsonRpcTx = {
  hash?: string;
  blockNumber?: string | null;
  from?: string;
  to?: string | null;
  value?: string;
};

/** Parse a recorded or live `eth_getTransactionByHash` result. */
export function networkRefFromRpcResult(hash: string, result: JsonRpcTx | null): NetworkRef | null {
  if (!result || typeof result !== 'object') return null;
  return {
    hash: typeof result.hash === 'string' ? result.hash : hash,
    blockNumber: result.blockNumber ?? null,
    from: result.from ?? null,
    to: result.to ?? null,
    valueWei: result.value ?? null,
    source: 'testnet-rpc',
  };
}

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Read-only public JSON-RPC lookup. No API keys.
 * Tests pass a `fetchFn` that returns a recorded response — never hits the network in CI.
 */
export async function lookupTransferByHash(
  hash: string,
  opts: { rpcUrl: string; fetchFn?: FetchLike },
): Promise<NetworkRef | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return null;
  }
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as FetchLike);
  const res = await fetchFn(opts.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionByHash',
      params: [hash],
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: JsonRpcTx | null };
  return networkRefFromRpcResult(hash, body.result ?? null);
}
