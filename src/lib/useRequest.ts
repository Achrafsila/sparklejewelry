import { useCallback, useRef, useState } from 'react';
import { callRpc } from './rpc';
import { AppError, toAppError } from './errors';

export interface RequestState<TArgs, TResult> {
  /** Runs the function once; a second call while one is in flight is ignored. Resolves to null on error. */
  run(args: TArgs): Promise<TResult | null>;
  pending: boolean;
  error: AppError | null;
  reset(): void;
}

/**
 * Calls a business function with an idempotency key (p_request_id).
 * The key is kept when the network fails (the server may have applied the change),
 * so a retry returns the stored result instead of applying it twice.
 */
export function useRequest<TArgs extends Record<string, unknown>, TResult>(fn: string): RequestState<TArgs, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (args: TArgs) => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setError(null);
      requestId.current ??= crypto.randomUUID();
      try {
        const result = await callRpc<TResult>(fn, { p_request_id: requestId.current, ...args });
        requestId.current = null;
        return result;
      } catch (e) {
        const err = toAppError(e);
        if (err.code !== 'RESEAU') requestId.current = null;
        setError(err);
        return null;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [fn],
  );

  const reset = useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}
