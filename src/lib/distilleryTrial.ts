/**
 * Parsira Firestore Timestamp, ISO string ili Date u validan Date ili null.
 */
export function parseTrialEndDate(raw: unknown): Date | null {
  if (raw == null) return null;
  try {
    const anyRaw = raw as { toDate?: () => Date };
    const d = typeof anyRaw?.toDate === "function" ? anyRaw.toDate() : new Date(raw as string | number | Date);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Neverifikovan proizvođač čiji je probni period (trialEndsAt) istekao —
 * nalog ostaje u sistemu, ali bez punog sadržaja (ograničena etiketa i dashboard).
 * Ako trialEndsAt nije u bazi, ne tretira se kao istekao (legacy nalozi).
 */
export function isPostTrialFrozen(distillery: { isVerified?: boolean; trialEndsAt?: unknown } | null | undefined): boolean {
  if (!distillery || distillery.isVerified === true) return false;
  const end = parseTrialEndDate(distillery.trialEndsAt);
  if (!end) return false;
  return end.getTime() < Date.now();
}
