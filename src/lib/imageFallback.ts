/** Neutralna silueta boce (bez teksta) — uvek sa istog hosta. */
export const RAKIVINUM_MARK_FALLBACK = "/placeholder-bottle.svg";

export function isImgFallbackUrl(src: string): boolean {
  return src.includes("placeholder-bottle.svg");
}

export function sanitizePublicImageUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\s*data:/i.test(trimmed) && trimmed.length > 220_000) return "";
  return trimmed;
}

export function pickBestProductImageUrl(product: {
  image?: unknown;
  bottleImageUrl?: unknown;
  galleryImages?: unknown;
}): string {
  const fromImage = sanitizePublicImageUrl(product.image);
  if (fromImage) return fromImage;

  const fromBottle = sanitizePublicImageUrl(product.bottleImageUrl);
  if (fromBottle) return fromBottle;

  if (Array.isArray(product.galleryImages)) {
    for (const candidate of product.galleryImages) {
      const fromGallery = sanitizePublicImageUrl(candidate);
      if (fromGallery) return fromGallery;
    }
  }

  return RAKIVINUM_MARK_FALLBACK;
}

export function hasUsablePublicProductImage(product: {
  image?: unknown;
  bottleImageUrl?: unknown;
  galleryImages?: unknown;
}): boolean {
  return pickBestProductImageUrl(product) !== RAKIVINUM_MARK_FALLBACK;
}
