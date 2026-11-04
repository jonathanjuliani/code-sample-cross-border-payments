export type ProviderStatus = {
  status: string;
  seq: number;
  detail?: Record<string, unknown>;
};

export class ProviderTimeout extends Error {
  constructor(message = 'provider timeout') {
    super(message);
    this.name = 'ProviderTimeout';
  }
}

export type Provider = {
  submit(ref: string, payload: unknown): Promise<{ accepted: true } | { declined: string }>;
  getStatus(ref: string): Promise<ProviderStatus | 'not_found'>;
};

export type ProviderMap = {
  collect: Provider;
  transfer: Provider;
  deposit: Provider;
  refund: Provider;
};

/** Test double: accepts every submit; status comes from an in-memory map set by tests. */
export function createInstantProvider(): Provider & {
  statuses: Map<string, ProviderStatus | 'not_found'>;
  submits: Array<{ ref: string; payload: unknown }>;
  setStatus(ref: string, status: ProviderStatus | 'not_found'): void;
} {
  const statuses = new Map<string, ProviderStatus | 'not_found'>();
  const submits: Array<{ ref: string; payload: unknown }> = [];

  return {
    statuses,
    submits,
    setStatus(ref, status) {
      statuses.set(ref, status);
    },
    async submit(ref, payload) {
      submits.push({ ref, payload });
      return { accepted: true as const };
    },
    async getStatus(ref) {
      return statuses.get(ref) ?? 'not_found';
    },
  };
}

export function createDecliningProvider(reason: string): Provider {
  return {
    async submit() {
      return { declined: reason };
    },
    async getStatus() {
      return 'not_found';
    },
  };
}

export function createTimeoutProvider(underlying?: Provider): Provider {
  return {
    async submit(ref, payload) {
      if (underlying) {
        // Record that the transfer "actually happened" for timeout-with-success scenarios.
        await underlying.submit(ref, payload).catch(() => undefined);
      }
      throw new ProviderTimeout();
    },
    async getStatus(ref) {
      return underlying ? underlying.getStatus(ref) : 'not_found';
    },
  };
}
