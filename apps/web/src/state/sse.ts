const ACCOUNT_ID = 'acct_demo';

export type SseHandlers = {
  onEvent: (event: string, data: unknown) => void;
  onError?: () => void;
  onOpen?: () => void;
};

/**
 * Fetch-based SSE so we can send X-Account-Id (EventSource cannot).
 * Returns an abort function.
 */
export function openSse(path: string, handlers: SseHandlers): () => void {
  const ac = new AbortController();

  void (async () => {
    try {
      const res = await fetch(`/api${path}`, {
        headers: { 'x-account-id': ACCOUNT_ID, accept: 'text/event-stream' },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        handlers.onError?.();
        return;
      }
      handlers.onOpen?.();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = 'message';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const raw = line.slice(5).trim();
            try {
              handlers.onEvent(eventName, JSON.parse(raw) as unknown);
            } catch {
              handlers.onEvent(eventName, raw);
            }
            eventName = 'message';
          } else if (line === '') {
            eventName = 'message';
          }
        }
      }
      if (!ac.signal.aborted) handlers.onError?.();
    } catch {
      if (!ac.signal.aborted) handlers.onError?.();
    }
  })();

  return () => ac.abort();
}
