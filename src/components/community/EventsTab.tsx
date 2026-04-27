import React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "../../lib/utils";
import type { CommunityEventItem } from "./types";

type EventsTabProps = {
  eventsView: "active" | "archive";
  setEventsView: (view: "active" | "archive") => void;
  visibleEvents: CommunityEventItem[];
};

export default function EventsTab({ eventsView, setEventsView, visibleEvents }: EventsTabProps) {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="card-elevated border border-white/8 rounded-[28px] overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="section-title">Manifestacije i događaji</h3>
          <div className="flex gap-1 p-0.5 bg-black/30 border border-white/8 rounded-xl shrink-0">
            {(["active", "archive"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setEventsView(v)}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all",
                  eventsView === v ? "bg-gold-500 text-black" : "text-text-secondary hover:text-white",
                )}
              >
                {v === "active" ? "Aktuelno" : "Arhiva"}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 space-y-2">
          {visibleEvents.length > 0 ? (
            visibleEvents.map((ev) => (
              <div key={ev.id} className="card-soft border border-white/8 rounded-2xl p-4 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-white font-semibold text-sm truncate">{ev.title || "Događaj"}</p>
                  <p className="text-[11px] text-gold-500 mt-0.5 flex items-center gap-1">
                    <CalendarDays className="w-3 h-3 shrink-0" /> {ev.eventDate || "Datum uskoro"}
                  </p>
                  {ev.location && typeof ev.location === "string" && (
                    <p className="text-[11px] text-text-secondary truncate mt-0.5">{ev.location}</p>
                  )}
                  {ev.description && <p className="text-[11px] text-text-secondary mt-1 line-clamp-2 leading-relaxed">{ev.description}</p>}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {(ev.websiteUrl || ev.link) && (
                    <a
                      href={ev.websiteUrl || ev.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center px-3 py-2 btn-tertiary text-[10px] font-bold no-underline"
                    >
                      Sajt
                    </a>
                  )}
                  {ev.mapsUrl && (
                    <a
                      href={ev.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[10px] font-bold text-blue-300 hover:bg-blue-500/15 transition-colors"
                    >
                      Mapa
                    </a>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-[12px] text-text-secondary italic py-6 text-center">
              {eventsView === "active" ? "Nema aktuelnih događaja." : "Arhiva je prazna."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
