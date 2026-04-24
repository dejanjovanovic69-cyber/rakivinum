export type BadgeRarity = "bronze" | "silver" | "gold" | "emerald" | "ruby" | "obsidian";

export type BadgeDef = {
  id: string;
  name: string;
  description: string;
  rarity: BadgeRarity;
  title: string;
};

type AchievementStats = {
  scansTotal: number;
  ratingsTotal: number;
  hasRakija: boolean;
  hasVino: boolean;
  clubsJoinedPeak: number;
};

export type UnlockedBadge = BadgeDef & {
  unlockedAt: number;
};

export type AchievementState = {
  stats: AchievementStats;
  badges: UnlockedBadge[];
  activeTitle: string;
};

const STORAGE_KEY = "rakivinum_achievements_v1";
const BADGE_EVENT = "rakivinum_badges_changed";

export const BADGE_DEFS: BadgeDef[] = [
  { id: "first-scan", name: "Prvi sken", description: "Prvi uspešan sken proizvoda.", rarity: "bronze", title: "Gost početnik" },
  { id: "explorer", name: "Istraživač", description: "Najmanje 10 skenova.", rarity: "silver", title: "Istraživač ukusa" },
  { id: "degustator", name: "Degustator", description: "Najmanje 5 ocena.", rarity: "gold", title: "Radoznali degustator" },
  { id: "diversity", name: "Raznolik ukus", description: "Rakija i vino u aktivnostima.", rarity: "emerald", title: "Vinski saputnik" },
  { id: "club-friend", name: "Klub prijatelj", description: "Član 2+ klubova.", rarity: "ruby", title: "Ambasador destilerije" },
  { id: "legend", name: "Legenda", description: "40 skenova, 15 ocena i 3 kluba.", rarity: "obsidian", title: "Legenda kluba" },
];

const EMPTY_STATE: AchievementState = {
  stats: {
    scansTotal: 0,
    ratingsTotal: 0,
    hasRakija: false,
    hasVino: false,
    clubsJoinedPeak: 0,
  },
  badges: [],
  activeTitle: "Gost",
};

const normalizeText = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/š/g, "s")
    .replace(/č/g, "c")
    .replace(/ć/g, "c")
    .replace(/ž/g, "z")
    .replace(/đ/g, "dj");

const isWineType = (type: string) => {
  const t = normalizeText(type);
  return t.includes("vino") || t.includes("belo") || t.includes("crveno") || t.includes("roze");
};

const isRakijaType = (type: string) => !isWineType(type);

export const getBadgeColorClass = (rarity: BadgeRarity) => {
  switch (rarity) {
    case "bronze":
      return "border-[#CD7F32]/60 bg-[#CD7F32]/10 text-[#CD7F32]";
    case "silver":
      return "border-[#C0C0C0]/60 bg-[#C0C0C0]/10 text-[#E5E7EB]";
    case "gold":
      return "border-gold-500/70 bg-gold-500/10 text-gold-500";
    case "emerald":
      return "border-emerald-500/60 bg-emerald-500/10 text-emerald-400";
    case "ruby":
      return "border-red-500/60 bg-red-500/10 text-red-400";
    case "obsidian":
      return "border-purple-500/70 bg-purple-500/10 text-purple-300";
    default:
      return "border-white/20 bg-white/5 text-white";
  }
};

const readState = (): AchievementState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw) as AchievementState;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_STATE };
    return {
      stats: { ...EMPTY_STATE.stats, ...(parsed.stats || {}) },
      badges: Array.isArray(parsed.badges) ? parsed.badges : [],
      activeTitle: typeof parsed.activeTitle === "string" && parsed.activeTitle ? parsed.activeTitle : "Gost",
    };
  } catch {
    return { ...EMPTY_STATE };
  }
};

const writeState = (state: AchievementState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(BADGE_EVENT));
};

const hasBadge = (state: AchievementState, id: string) => state.badges.some((b) => b.id === id);

const maybeUnlock = (state: AchievementState): UnlockedBadge[] => {
  const unlockedNow: UnlockedBadge[] = [];
  const { scansTotal, ratingsTotal, hasRakija, hasVino, clubsJoinedPeak } = state.stats;

  const rules: Array<{ id: string; ok: boolean }> = [
    { id: "first-scan", ok: scansTotal >= 1 },
    { id: "explorer", ok: scansTotal >= 10 },
    { id: "degustator", ok: ratingsTotal >= 5 },
    { id: "diversity", ok: hasRakija && hasVino && ratingsTotal >= 2 },
    { id: "club-friend", ok: clubsJoinedPeak >= 2 },
    { id: "legend", ok: scansTotal >= 40 && ratingsTotal >= 15 && clubsJoinedPeak >= 3 },
  ];

  for (const rule of rules) {
    if (!rule.ok || hasBadge(state, rule.id)) continue;
    const def = BADGE_DEFS.find((b) => b.id === rule.id);
    if (!def) continue;
    const b: UnlockedBadge = { ...def, unlockedAt: Date.now() };
    state.badges.push(b);
    state.activeTitle = def.title;
    unlockedNow.push(b);
  }
  return unlockedNow;
};

export const recordScanAchievement = (productType: string | null | undefined): UnlockedBadge[] => {
  const state = readState();
  state.stats.scansTotal += 1;
  const t = normalizeText(productType);
  if (t) {
    if (isWineType(t)) state.stats.hasVino = true;
    if (isRakijaType(t)) state.stats.hasRakija = true;
  }
  const unlocked = maybeUnlock(state);
  writeState(state);
  return unlocked;
};

export const recordRatingAchievement = (productType: string | null | undefined): UnlockedBadge[] => {
  const state = readState();
  state.stats.ratingsTotal += 1;
  const t = normalizeText(productType);
  if (t) {
    if (isWineType(t)) state.stats.hasVino = true;
    if (isRakijaType(t)) state.stats.hasRakija = true;
  }
  const unlocked = maybeUnlock(state);
  writeState(state);
  return unlocked;
};

export const recordClubMembershipAchievement = (clubsCount: number): UnlockedBadge[] => {
  const state = readState();
  state.stats.clubsJoinedPeak = Math.max(state.stats.clubsJoinedPeak, clubsCount || 0);
  const unlocked = maybeUnlock(state);
  writeState(state);
  return unlocked;
};

export const getAchievementSummary = () => {
  const state = readState();
  return {
    badges: [...state.badges].sort((a, b) => b.unlockedAt - a.unlockedAt),
    activeTitle: state.activeTitle,
    stats: state.stats,
  };
};

export const getNextBadgeProgress = () => {
  const state = readState();
  const { scansTotal, ratingsTotal, hasRakija, hasVino, clubsJoinedPeak } = state.stats;
  const unlocked = new Set(state.badges.map((b) => b.id));

  const candidates: Array<{ id: string; details: string }> = [
    { id: "first-scan", details: `Skenovi: ${Math.min(scansTotal, 1)}/1` },
    { id: "explorer", details: `Skenovi: ${Math.min(scansTotal, 10)}/10` },
    { id: "degustator", details: `Ocene: ${Math.min(ratingsTotal, 5)}/5` },
    {
      id: "diversity",
      details: `Ocene: ${Math.min(ratingsTotal, 2)}/2 • Rakija: ${hasRakija ? "da" : "ne"} • Vino: ${hasVino ? "da" : "ne"}`,
    },
    { id: "club-friend", details: `Klubovi: ${Math.min(clubsJoinedPeak, 2)}/2` },
    { id: "legend", details: `Skenovi: ${Math.min(scansTotal, 40)}/40 • Ocene: ${Math.min(ratingsTotal, 15)}/15 • Klubovi: ${Math.min(clubsJoinedPeak, 3)}/3` },
  ];

  const next = candidates.find((c) => !unlocked.has(c.id));
  if (!next) return null;
  const def = BADGE_DEFS.find((b) => b.id === next.id);
  if (!def) return null;

  return {
    id: def.id,
    name: def.name,
    title: def.title,
    details: next.details,
  };
};

export const ACHIEVEMENT_EVENT_NAME = BADGE_EVENT;
