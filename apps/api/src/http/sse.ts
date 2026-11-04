import type { FastifyReply, FastifyRequest } from 'fastify';

export type SseSession = {
  write: (event: string, data: unknown) => void;
  close: () => void;
};

/** Open a text/event-stream response. Caller must stop writing after `close` / request close. */
export function openSse(request: FastifyRequest, reply: FastifyReply): SseSession {
  const res = reply.raw;
  reply.hijack();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      res.end();
    } catch {
      /* ignore */
    }
  };

  request.raw.on('close', close);

  return {
    write(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close,
  };
}
