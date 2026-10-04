import {
  MutationCache,
  QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { isRetryable } from "@/lib/api/errors";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Keys that are stale once the mutation succeeded. */
      invalidates?: readonly QueryKey[];
      /**
       * The caller shows the error itself (a form, a confirmation dialog).
       * Without it, a failed mutation is reported as a toast.
       */
      silent?: boolean;
    };
  }
}

export interface QueryClientHooks {
  /** A mutation failed and nobody shows its error. */
  onUnhandledMutationError: (error: unknown) => void;
}

/**
 * The cache of everything read from the API.
 *
 * - Reads are fresh for a short while, are repeated when the window gets
 *   the focus back (other admins and customers change things), and are
 *   retried only when asking again can help (network, 429, 502 to 504).
 * - Writes are never retried by themselves: a second attempt could do the
 *   thing twice.
 * - After every successful write, what it touched is fetched again
 *   (`meta.invalidates`).
 */
export function createQueryClient(hooks: QueryClientHooks): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failures, error) => isRetryable(error) && failures < 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: { retry: false },
    },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        for (const queryKey of mutation.meta?.invalidates ?? []) {
          void client.invalidateQueries({ queryKey });
        }
      },
      onError: (error, _variables, _context, mutation) => {
        if (!mutation.meta?.silent) hooks.onUnhandledMutationError(error);
      },
    }),
  });
  return client;
}
