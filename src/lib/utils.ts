import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Srpska množina uz broj. Pravilo je trodelno, pa `n === 1 ? a : b` uvek greši
 * na 2–4 („2 boca“ umesto „2 boce“).
 *
 *   pluralSr(1, "boca", "boce", "boca")  → "boca"
 *   pluralSr(3, "boca", "boce", "boca")  → "boce"
 *   pluralSr(7, "boca", "boce", "boca")  → "boca"
 */
export function pluralSr(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
