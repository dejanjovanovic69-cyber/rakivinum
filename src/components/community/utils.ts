import type { DistilleryItem, ProductItem, RatingItem } from "./types";

export function safeStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return [obj.city, obj.address]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      .join(", ");
  }
  return "";
}

export function normalizeText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/š/g, "s")
    .replace(/č/g, "c")
    .replace(/ć/g, "c")
    .replace(/ž/g, "z")
    .replace(/đ/g, "dj");
}

export function isWineProduct(product: ProductItem): boolean {
  const normalized = `${normalizeText(product?.name)} ${normalizeText(product?.type)} ${normalizeText(product?.category)}`;
  return normalized.includes("vino") || normalized.includes("wine");
}

export function matchesProductFilter(product: ProductItem, activeProductFilter: string): boolean {
  if (activeProductFilter === "all") return true;
  const normalized = `${normalizeText(product?.name)} ${normalizeText(product?.type)} ${normalizeText(product?.category)}`;
  if (activeProductFilter === "sve-rakije") return !isWineProduct(product);
  if (activeProductFilter === "sva-vina") return isWineProduct(product);
  if (activeProductFilter === "sljivovica") return normalized.includes("sljiv");
  if (activeProductFilter === "dunjevaca") return normalized.includes("dunjev");
  if (activeProductFilter === "kruskovaca") return normalized.includes("krusk") || normalized.includes("krus");
  if (activeProductFilter === "bela-vina") return (normalized.includes("vino") || normalized.includes("vina")) && (normalized.includes("belo") || normalized.includes("white"));
  if (activeProductFilter === "crvena-vina") return (normalized.includes("vino") || normalized.includes("vina")) && (normalized.includes("crveno") || normalized.includes("red"));
  if (activeProductFilter === "roze") return (normalized.includes("vino") || normalized.includes("vina")) && (normalized.includes("roze") || normalized.includes("rose"));
  return true;
}

export function distLocation(distillery: DistilleryItem): string {
  if (typeof distillery.location === "string") return distillery.location;
  if (distillery.location?.city || distillery.location?.address) {
    return [distillery.location.city, distillery.location.address].filter(Boolean).join(", ");
  }
  return distillery.region || "Srbija";
}

export function metricVal(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function findCompareMatches(comparePool: ProductItem[], queryText: string, excludeId?: string): ProductItem[] {
  const query = normalizeText(queryText.trim());
  if (!query) return [];
  return comparePool
    .filter((product) => product.id !== excludeId)
    .filter(
      (product) =>
        normalizeText(product.name).includes(query) ||
        normalizeText(product.type).includes(query) ||
        normalizeText(product.category).includes(query) ||
        normalizeText(product.distillery).includes(query),
    )
    .slice(0, 10);
}

export function buildCompareCandidateList(
  comparePool: ProductItem[],
  queryText: string,
  matches: ProductItem[],
  excludeId: string,
): ProductItem[] {
  return (queryText.trim() ? matches : comparePool.filter((product) => product.id !== excludeId)).slice(0, 8);
}

export function formatRatingDate(value: RatingItem["createdAt"]): string {
  if (!value) return "Sada";
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Sada" : date.toLocaleDateString("sr-RS");
  }
  if (value instanceof Date) return value.toLocaleDateString("sr-RS");
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toLocaleDateString("sr-RS");
  }
  return "Sada";
}
