/**
 * Čišćenje teksta iz mejla / PDF-a (uglaste zagrade, navodnici, nevidljivi znakovi).
 */
function sanitizePastedLicenseText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[\s<"'(]+|[\s>)"'.]+$/g, '')
    .trim();
}

/**
 * Iz celog URL-a ili sirovog teksta izvlači vrednost tokena za /activate?token=...
 */
/**
 * ID dokumenta u Firestore je tačan string; generator koristi velika slova u segmentu posle lic_.
 * Korisnik ponekad nalepi mešavinu malih/velikih slova — ujednači pre getDoc/updateDoc.
 */
export function normalizeLicenseToken(raw: string): string {
  const s = sanitizePastedLicenseText(raw).replace(/\s+/g, "");
  const m = s.match(/^lic_(.+)$/i);
  if (!m) return s;
  return "lic_" + m[1].toUpperCase();
}

export function extractActivateTokenFromInput(raw: string): string | null {
  let s = sanitizePastedLicenseText(raw);
  if (!s) return null;

  // Jedan URL po redu (ako je nalepljeno više linija, uzmi prvu koja liči na link)
  const lines = s.split(/\r?\n/).map((l) => sanitizePastedLicenseText(l)).filter(Boolean);
  const urlLine = lines.find((l) => /https?:\/\//i.test(l) || l.includes('activate')) || lines[0] || s;
  s = urlLine;

  const fromQuery = s.match(/[?&#]token=([^&#\s"'<>]+)/i);
  if (fromQuery?.[1]) {
    try {
      const dec = decodeURIComponent(fromQuery[1].trim()).replace(/[\s<>"'.]+$/, "");
      return dec.match(/^lic_/i) ? normalizeLicenseToken(dec) : dec;
    } catch {
      const t = fromQuery[1].trim().replace(/[\s<>"'.]+$/, "");
      return t.match(/^lic_/i) ? normalizeLicenseToken(t) : t;
    }
  }

  const oneLine = s.replace(/\s+/g, '').replace(/^[^a-z0-9_]+/i, '');
  if (/^lic_[a-z0-9_]+$/i.test(oneLine)) return normalizeLicenseToken(oneLine);
  if (oneLine.length >= 10 && !/[/?#]/.test(oneLine)) {
    return oneLine.match(/^lic_/i) ? normalizeLicenseToken(oneLine) : oneLine;
  }
  return null;
}

export function isLicensedLocalStorage(): boolean {
  return (
    localStorage.getItem('rakivinum_licensed') === 'true' ||
    localStorage.getItem('rakija_licensed') === 'true'
  );
}
