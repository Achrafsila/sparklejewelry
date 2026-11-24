import { supabase } from './supabase';
import { toAppError } from './errors';

/** Calls a business function; throws an AppError with the server's code and details. */
export async function callRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let result: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    result = await supabase.rpc(fn, args);
  } catch (e) {
    throw toAppError(e);
  }
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}

/** Unwraps a PostgREST read, mapping errors to AppError. */
export async function read<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  let result: { data: T | null; error: unknown };
  try {
    result = await query;
  } catch (e) {
    throw toAppError(e);
  }
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}
