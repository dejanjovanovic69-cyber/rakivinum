import { app } from "./firebase";
import { getAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled, type Analytics } from "firebase/analytics";

let analyticsRef: Analytics | null = null;
let analyticsInitPromise: Promise<Analytics | null> | null = null;

async function getAnalyticsInstance(): Promise<Analytics | null> {
  if (typeof window === "undefined") return null;
  if (analyticsRef) return analyticsRef;
  if (analyticsInitPromise) return analyticsInitPromise;

  analyticsInitPromise = (async () => {
    try {
      const supported = await isSupported();
      if (!supported) return null;
      const analytics = getAnalytics(app);
      setAnalyticsCollectionEnabled(analytics, true);
      analyticsRef = analytics;
      return analytics;
    } catch {
      return null;
    }
  })();

  return analyticsInitPromise;
}

export async function trackAnalyticsEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>,
): Promise<void> {
  try {
    const analytics = await getAnalyticsInstance();
    if (!analytics) return;
    logEvent(analytics, eventName, params);
  } catch {
    // best-effort only
  }
}
