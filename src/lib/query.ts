import { MutationCache, QueryClient } from "@tanstack/react-query";

// eslint-disable-next-line no-restricted-imports -- the barrel would put every component on the boot path
import { reportUnhandledFailure } from "@/components/Toast";

/** What a mutation may declare about itself for the layers above it. */
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /**
       * This mutation reports its own failure, so the default toast stays out.
       *
       * An `onError` is not the declaration: a handler that only rolls an
       * optimistic update back leaves the reader with a silent snap-back, and a
       * handler passed per call through `mutate(vars, { onError })` never
       * reaches `mutation.options` at all.
       */
      silentError?: boolean;
    };
  }
}

/**
 * The client every screen shares.
 *
 * A mutation that does not declare `silentError` reports its failure through
 * the default toast, so silence is a choice rather than an omission.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60, // 1 minute
        retry: 1,
      },
    },
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.silentError) return;
        reportUnhandledFailure(error);
      },
    }),
  });
}

export const queryClient = createAppQueryClient();
