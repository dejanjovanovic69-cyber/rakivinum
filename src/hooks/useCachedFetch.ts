import { useCallback, useEffect, useRef, useState } from "react";

export type UseCachedFetchOptions<T> = {
  enabled?: boolean;
  parser?: (raw: unknown) => T;
  init?: RequestInit;
};

export type UseCachedFetchResult<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

export function useCachedFetch<T>(
  url: string,
  options: UseCachedFetchOptions<T> = {},
): UseCachedFetchResult<T> {
  const { enabled = true, parser, init } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef<boolean>(false);
  const initRef = useRef<RequestInit | undefined>(init);
  const parserRef = useRef<typeof parser>(parser);

  useEffect(() => {
    initRef.current = init;
  }, [init]);

  useEffect(() => {
    parserRef.current = parser;
  }, [parser]);

  const run = useCallback(async () => {
    if (!enabled) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    const stableInit = initRef.current;
    const stableParser = parserRef.current;

    try {
      const response = await fetch(url, {
        ...stableInit,
        method: stableInit?.method ?? "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(stableInit?.headers || {}),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const raw = (await response.json()) as unknown;
      const parsed = stableParser ? stableParser(raw) : (raw as T);

      if (!mountedRef.current || controller.signal.aborted) return;
      setData(parsed);
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [enabled, url]);

  useEffect(() => {
    mountedRef.current = true;
    void run();

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [run]);

  const refetch = useCallback(async () => {
    await run();
  }, [run]);

  return { data, loading, error, refetch };
}
