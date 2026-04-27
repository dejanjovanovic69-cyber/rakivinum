export function stableQueryOptions(staleTimeMs: number, gcTimeMs: number = staleTimeMs) {
  return {
    staleTime: staleTimeMs,
    gcTime: gcTimeMs,
    refetchOnWindowFocus: false as const,
  };
}
