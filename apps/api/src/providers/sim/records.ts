export type SimLegRecord = {
  status: string;
  amountMinor: number;
  rateE4?: number;
  txHash?: string;
  networkFeeMinor?: number;
  convertMinor?: number;
};

export type SimRecords = {
  collect: Map<string, SimLegRecord>;
  chain: Map<string, SimLegRecord>;
  offramp: Map<string, SimLegRecord>;
  refund: Map<string, SimLegRecord>;
};

export function createSimRecords(): SimRecords {
  return {
    collect: new Map(),
    chain: new Map(),
    offramp: new Map(),
    refund: new Map(),
  };
}

export function clearSimRecords(records: SimRecords): void {
  records.collect.clear();
  records.chain.clear();
  records.offramp.clear();
  records.refund.clear();
}
