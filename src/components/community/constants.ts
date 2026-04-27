import type { CommunitySection, CompareFilterOption, FilterOption } from "./types";

export const COMMUNITY_SECTIONS: readonly CommunitySection[] = [
  "reviews",
  "tops",
  "compare",
  "producers",
  "search",
  "events",
] as const;

export const COMMUNITY_TAB_ITEMS: ReadonlyArray<{ id: CommunitySection; label: string }> = [
  { id: "reviews", label: "Utisci" },
  { id: "tops", label: "Top 10" },
  { id: "compare", label: "Uporedi" },
  { id: "producers", label: "Destilerije" },
  { id: "search", label: "Pretraga" },
  { id: "events", label: "Događaji" },
];

export const COMMUNITY_FILTER_OPTIONS: readonly FilterOption[] = [
  { id: "all", label: "Sve" },
  { id: "sve-rakije", label: "Sve rakije" },
  { id: "sva-vina", label: "Sva vina" },
  { id: "sljivovica", label: "Šljivovica" },
  { id: "dunjevaca", label: "Dunjevača" },
  { id: "kruskovaca", label: "Kruškovaca" },
  { id: "bela-vina", label: "Bela vina" },
  { id: "crvena-vina", label: "Crvena vina" },
  { id: "roze", label: "Roze" },
];

export const COMMUNITY_COMPARE_FILTER_OPTIONS: readonly CompareFilterOption[] = [
  { id: "all", label: "Sve" },
  { id: "sve-rakije", label: "Sve rakije" },
  { id: "sljivovica", label: "Šljivovice" },
  { id: "dunjevaca", label: "Dunjevače" },
  { id: "kruskovaca", label: "Kruškovače" },
  { id: "sva-vina", label: "Sva vina" },
  { id: "bela-vina", label: "Bela vina" },
  { id: "crvena-vina", label: "Crvena vina" },
  { id: "roze", label: "Roze" },
];

export function toCommunitySection(search: string): CommunitySection {
  const tab = new URLSearchParams(search).get("tab");
  return COMMUNITY_SECTIONS.includes(tab as CommunitySection) ? (tab as CommunitySection) : "reviews";
}
