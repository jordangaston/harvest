import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Freshness model: serve from cache, refetch only when the data changes.
 * A long `staleTime` means a revisit within the window is a cache hit (no
 * network); the real freshness signal is a mutation calling
 * `invalidateQueries` on the key it changed. `gcTime` keeps the cache alive
 * long enough to be worth persisting to disk.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — a revisit inside this serves cache
      gcTime: DAY,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Persists the whole cache to AsyncStorage so it survives app restarts. */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "harvest.query-cache",
});

export const persistOptions = { persister, maxAge: DAY } as const;
