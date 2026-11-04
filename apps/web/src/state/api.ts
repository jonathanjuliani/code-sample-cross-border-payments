import { type ErrorBody, ErrorBodySchema } from '@payout/shared';

const ACCOUNT_ID = 'acct_demo';

export type Schema<T> = { parse: (data: unknown) => T };

export type ApiOk<T> = { ok: true; data: T; status: number };
export type ApiErr = {
  ok: false;
  error: string;
  message: string;
  status: number;
  offline: boolean;
  body?: ErrorBody;
};

export type ApiResult<T> = ApiOk<T> | ApiErr;

export async function request<T>(
  path: string,
  init: RequestInit & { schema: Schema<T> },
): Promise<ApiResult<T>> {
  const { schema, headers, ...rest } = init;
  try {
    const res = await fetch(`/api${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        'x-account-id': ACCOUNT_ID,
        ...(headers ?? {}),
      },
    });

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        return {
          ok: false,
          error: 'invalid_json',
          message: 'Response was not JSON',
          status: res.status,
          offline: false,
        };
      }
    }

    if (!res.ok) {
      const parsed = ErrorBodySchema.safeParse(json);
      return {
        ok: false,
        error: parsed.success ? parsed.data.error : 'request_failed',
        message: parsed.success ? parsed.data.message : `HTTP ${res.status}`,
        status: res.status,
        offline: false,
        ...(parsed.success ? { body: parsed.data } : {}),
      };
    }

    const data = schema.parse(json);
    return { ok: true, data, status: res.status };
  } catch {
    return {
      ok: false,
      error: 'offline',
      message: "Can't reach the server right now",
      status: 0,
      offline: true,
    };
  }
}
