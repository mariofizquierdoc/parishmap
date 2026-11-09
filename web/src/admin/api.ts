import type { ApiErrorBody } from '@parishmap/shared/admin';

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.error);
  }
}

export async function adminRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = options.body === undefined ? 'GET' : 'POST', body, signal } = options;
  const response = await fetch(`/api/admin${path}`, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({ error: 'generic' }))) as ApiErrorBody;
    throw new AdminApiError(response.status, errorBody);
  }
  return (await response.json()) as T;
}
