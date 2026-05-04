/** Neutralna silueta boce (bez teksta) — uvek sa istog hosta. */
export const RAKIVINUM_MARK_FALLBACK = "/placeholder-bottle.svg";

export function isImgFallbackUrl(src: string): boolean {
  return src.includes("placeholder-bottle.svg");
}
