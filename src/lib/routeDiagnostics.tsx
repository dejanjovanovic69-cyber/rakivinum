import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

/**
 * Privremeno isključivanje ruta (dijagnostika read-ova / ponašanja).
 * U `.env.local` npr.:
 *   VITE_DISABLED_ROUTES=/community,/scan,/menu,/distilleries,/collection,/radionica,/my-clubs
 * Pravilo bez vodećeg "/" se normalizuje. Prefiks: `/label` isključuje sve `/label/...`.
 */
function parseDisabledRouteRules(): string[] {
  const raw = String(import.meta.env.VITE_DISABLED_ROUTES || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("/") ? s : `/${s}`));
}

const disabledRules = parseDisabledRouteRules();

export function isRoutePathDisabled(pathname: string): boolean {
  if (disabledRules.length === 0) return false;
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  for (const rule of disabledRules) {
    const r = rule.replace(/\/+$/, "") || "/";
    if (r === "/") {
      if (path === "/" || path === "") return true;
      continue;
    }
    if (path === r || path.startsWith(`${r}/`)) return true;
  }
  return false;
}

export function disabledRoutesEnvSummary(): string {
  return disabledRules.length ? disabledRules.join(", ") : "";
}

export function DisabledRouteMessage() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-[55vh] flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <p className="text-sm text-text-secondary max-w-md leading-relaxed">
        Ova ruta je privremeno isključena radi dijagnostike. Ukloni ili izmeni{" "}
        <code className="text-gold-500/90 text-xs">VITE_DISABLED_ROUTES</code> u env-u i ponovo pokreni dev / rebuild.
      </p>
      <p className="text-[11px] text-text-secondary/70">
        Trenutna putanja: <code className="text-white/90">{pathname}</code>
      </p>
      {disabledRules.length > 0 && (
        <p className="text-[10px] text-text-secondary/60 max-w-md">
          Aktivna pravila: <code className="break-all">{disabledRoutesEnvSummary()}</code>
        </p>
      )}
      <Link
        to="/"
        className="mt-2 inline-flex items-center justify-center rounded-xl border border-gold-500/35 bg-gold-500/10 px-5 py-3 text-xs font-black uppercase tracking-widest text-gold-500 hover:bg-gold-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
      >
        Početna
      </Link>
    </div>
  );
}

/** Omotač oko lazy stranice: ako je putanja na listi, ne mountuje decu (nema chunk-a / read-ova te rute). */
export function DiagnosticRouteGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  if (isRoutePathDisabled(pathname)) return <DisabledRouteMessage />;
  return <>{children}</>;
}
