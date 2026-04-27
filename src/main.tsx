import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './lib/requestMeter';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { getFirebaseRedirectResultOnce } from './lib/firebaseRedirectResult';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function normalizeNameLikeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const city = typeof o.city === "string" ? o.city.trim() : "";
    const address = typeof o.address === "string" ? o.address.trim() : "";
    if (city || address) return [city, address].filter(Boolean).join(", ");
  }
  return "";
}

function sanitizePendingStorage() {
  try {
    const rawQueue = localStorage.getItem("rakivinum_pending_ratings") || "[]";
    const parsedQueue = JSON.parse(rawQueue);
    const queue = Array.isArray(parsedQueue) ? parsedQueue : [];
    const normalizedQueue = queue
      .map((x: unknown) => {
        const item = x as { id?: unknown; name?: unknown; timestamp?: unknown } | null;
        return {
          id: String(item?.id || ""),
          name: normalizeNameLikeValue(item?.name) || "Piće",
          timestamp: Number(item?.timestamp || 0),
        };
      })
      .filter((x) => x.id.length > 0 && Number.isFinite(x.timestamp) && x.timestamp > 0);
    localStorage.setItem("rakivinum_pending_ratings", JSON.stringify(normalizedQueue));

    const rawLegacy = localStorage.getItem("rakivinum_pending_rating");
    if (rawLegacy) {
      const legacy = JSON.parse(rawLegacy);
      const normalizedLegacy = {
        id: String(legacy?.id || ""),
        name: normalizeNameLikeValue(legacy?.name) || "Piće",
        timestamp: Number(legacy?.timestamp || Date.now()),
      };
      if (!normalizedLegacy.id) {
        localStorage.removeItem("rakivinum_pending_rating");
      } else {
        localStorage.setItem("rakivinum_pending_rating", JSON.stringify(normalizedLegacy));
      }
    }
  } catch {
    localStorage.removeItem("rakivinum_pending_rating");
    localStorage.setItem("rakivinum_pending_ratings", "[]");
  }
}

async function disableServiceWorkerInDev() {
  if (!import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch (e) {
    console.warn("Failed to unregister service workers in dev", e);
  }

  try {
    // Clear caches to avoid stale assets causing auth redirect loops
    const cachesAny = (globalThis as { caches?: CacheStorage }).caches;
    if (cachesAny?.keys) {
      const keys = await cachesAny.keys();
      await Promise.all(keys.map((k) => cachesAny.delete(k)));
    }
  } catch (e) {
    console.warn("Failed to clear caches in dev", e);
  }
}

/**
 * OAuth redirect must finish before the PWA service worker registers; otherwise
 * Workbox can race with Firebase and you stay "Gost" after Google sign-in.
 */
async function bootstrap() {
  sanitizePendingStorage();
  await disableServiceWorkerInDev();

  try {
    await getFirebaseRedirectResultOnce();
  } catch {
    // Menu also consumes the same promise and shows errors; avoid unhandled rejection.
  }

  if (import.meta.env.PROD) {
    registerSW({ immediate: true });
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap();
