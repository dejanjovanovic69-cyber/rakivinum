import {createRoot} from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

const EMERGENCY_MAINTENANCE_LOCK = false;

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
  const root = createRoot(document.getElementById('root')!);
  if (EMERGENCY_MAINTENANCE_LOCK) {
    root.render(
      <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <section className="max-w-xl text-center space-y-4">
          <h1 className="text-2xl font-bold">Rakivinum je privremeno u maintenance režimu</h1>
          <p className="text-sm text-white/80">
            Privremeno je isključen pristup aplikaciji dok stabilizujemo Firestore potrošnju.
            Servis će biti vraćen čim zaštita bude potvrđena.
          </p>
        </section>
      </main>,
    );
    return;
  }

  sanitizePendingStorage();
  await disableServiceWorkerInDev();

  const { default: App } = await import('./App.tsx');
  const { getFirebaseRedirectResultOnce } = await import('./lib/firebaseRedirectResult');
  const { registerSW } = await import('virtual:pwa-register');
  await getFirebaseRedirectResultOnce().catch(() => {
    // Menu also consumes the same promise and shows errors; avoid unhandled rejection.
  });
  if (import.meta.env.PROD) registerSW({ immediate: true });

  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

void bootstrap();
