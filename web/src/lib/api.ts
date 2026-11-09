import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`Request failed with HTTP ${status}`);
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as T;
}

type LoadState<T> =
  { status: 'loading' } | { status: 'error'; notFound: boolean } | { status: 'ready'; data: T };

/** Runs a loader when `key` changes, ignoring responses that arrive after it has changed again. */
export function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          notFound: error instanceof ApiError && error.status === 404,
        });
      });
    return () => controller.abort();
    // `load` is deliberately left out: it's expected to change only along with `key`.
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
