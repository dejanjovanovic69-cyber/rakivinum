import React from "react";
import { CalendarDays, Compass, Scale, Search } from "lucide-react";
import { cn } from "../../lib/utils";
import { COMMUNITY_TAB_ITEMS } from "./constants";
import type { CommunitySection } from "./types";

type CommunityTabBarProps = {
  activeSection: CommunitySection;
  onTabSelect: (section: CommunitySection) => void;
};

function getTabIcon(section: CommunitySection): React.ReactNode {
  if (section === "compare") return <Scale className="w-3 h-3" />;
  if (section === "producers") return <Compass className="w-3 h-3" />;
  if (section === "search") return <Search className="w-3 h-3" />;
  if (section === "events") return <CalendarDays className="w-3 h-3" />;
  return null;
}

export default function CommunityTabBar({ activeSection, onTabSelect }: CommunityTabBarProps) {
  return (
    <div className="card-elevated border border-white/10 rounded-2xl p-1 overflow-x-auto grab-scrollbar -mx-1 px-1 pb-1">
      <div className="flex gap-1 min-w-max snap-x snap-mandatory">
        {COMMUNITY_TAB_ITEMS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabSelect(tab.id)}
            className={cn(
              "min-h-[42px] min-w-[116px] px-3 py-2 text-[10px] font-black uppercase tracking-wide whitespace-nowrap leading-none rounded-xl transition-all duration-200 active:scale-[0.98] inline-flex items-center justify-center gap-1 snap-start",
              activeSection === tab.id ? "bg-gold-500 text-black shadow-[0_4px_12px_rgba(212,175,55,0.22)]" : "text-text-secondary hover:text-white",
            )}
          >
            {getTabIcon(tab.id)}
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
