/**
 * Worker host baked into production builds. The `ldjs1969` workers.dev URL was left on an
 * older Worker revision (public lists capped at 5 rows). `wrangler deploy` from this repo
 * publishes `rakivinum-api` on the account that serves `dejanjovanovic69.workers.dev`.
 */
const LEGACY_STALE_PUBLIC_EDGE = "https://rakivinum-api.ldjs1969.workers.dev";
const DEFAULT_PUBLIC_EDGE = "https://rakivinum-api.dejanjovanovic69.workers.dev";

export function resolveEdgeApiBase(): string {
  const fromEnv = String(import.meta.env.VITE_EDGE_API_BASE || "").trim();
  if (fromEnv && fromEnv !== LEGACY_STALE_PUBLIC_EDGE) {
    return fromEnv;
  }
  if (import.meta.env.DEV && !fromEnv) {
    return "";
  }
  return DEFAULT_PUBLIC_EDGE;
}
