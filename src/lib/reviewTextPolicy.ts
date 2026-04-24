/**
 * Pravila za anonimne tekstualne ocene: bez psovki, bez PII, bez imena i mesta.
 */

const BAD_WORDS = [
  "kurac",
  "kurč",
  "picka",
  "pička",
  "pizda",
  "govno",
  "sranje",
  "budalo",
  "idiote",
  "idiot",
  "glupak",
  "glupa",
  "jeb",
  "jebi",
  "smece",
  "smeće",
  "psovka",
  "mamu ti",
  "majku ti",
];

/** Uobičajena imena (mala slova, bez dijakritika za uporedjivanje) */
const GIVEN_NAMES = new Set(
  [
    "dejan", "marko", "ana", "milos", "nikola", "jelena", "stefan", "dragan", "zoran",
    "ivana", "milica", "tamara", "boris", "filip", "petar", "pavle", "dusan", "goran",
    "branko", "ljiljana", "vesna", "snezana", "radovan", "tomislav", "igor",
    "bojan", "vladimir", "nenad", "sasa", "milan", "darko", "uros",
    "lazar", "matija", "andrija", "jovan", "nemanja", "strahinja", "vuk", "teodora", "marija",
    "katarina", "sofija", "helena", "danijela", "sanja", "dragana", "gordana", "oliver",
    "aleksandar", "aleksandra", "dimitrije", "kosta", "luka", "nikolina",
    "biserka", "zvezdan", "ceca", "svetlana", "radoslav", "predrag", "miodrag",
  ].map((w) => normalizeWord(w))
);

/** Gradovi i veća mesta — ne smeju u tekstu ocene (anonimnost) */
const PLACE_NAMES = new Set(
  [
    "beograd", "nis", "kragujevac", "subotica", "zrenjanin", "pancevo",
    "cacak", "smederevo", "leskovac", "valjevo", "krusevac",
    "sombor", "pozarevac", "pirot", "jagodina", "vranje", "kraljevo", "zajecar",
    "uzice", "sabac", "ruma", "indjija",
    "apatin", "obrenovac", "lazarevac", "mladenovac", "sumadija", "vojvodina",
    "kosjeric", "zlatibor", "tara", "sarajevo", "skoplje", "podgorica", "zagreb", "ljubljana",
    "tivat", "budva", "srbija", "hrvatska", "bosna",
  ].map((w) => normalizeWord(w))
);

/** Fraze od dve ili više reči (normalizovano bez razmaka za podstring) */
const PLACE_PHRASES_COMPACT = [
  "novisad", "novipazar", "starapazova", "backapalanka", "sremskamitrovica", "banjaluka",
  "fruskagora", "novavaros", "backatopola", "crnagora",
];

function normalizeWord(w: string): string {
  return w
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** Ceo tekst u oblik pogodan za pretragu tokena */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-zčćžšđ0-9]+/i)
    .filter(Boolean);
}

function hasBadWord(lowerText: string): boolean {
  return BAD_WORDS.some((w) => lowerText.includes(w));
}

function hasEmail(text: string): boolean {
  return /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
}

function hasPhone(text: string): boolean {
  return /(?:\+?381|0)[6-9]\d{6,8}/.test(text);
}

/** Dva uzastopna „ljudska“ tokena: ime + prezime ili ime + grad (heuristika) */
function compactLetters(text: string): string {
  return normalizeWord(text).replace(/[^a-zčćžšđ]+/g, "");
}

function hasLikelyFullNameOrNameWithPlace(text: string): boolean {
  const compact = compactLetters(text);
  for (const ph of PLACE_PHRASES_COMPACT) {
    if (compact.includes(ph)) return true;
  }

  const tokens = tokenize(text);
  const set = new Set(tokens.map((t) => normalizeWord(t)));

  for (let i = 0; i < tokens.length - 1; i++) {
    const a = normalizeWord(tokens[i]);
    const b = normalizeWord(tokens[i + 1]);
    if (a.length < 3 || b.length < 3) continue;
    if (GIVEN_NAMES.has(a) && GIVEN_NAMES.has(b)) return true;
    if (GIVEN_NAMES.has(a) && PLACE_NAMES.has(b)) return true;
    if (PLACE_NAMES.has(a) && GIVEN_NAMES.has(b)) return true;
  }

  for (const t of set) {
    if (t.length < 3) continue;
    if (GIVEN_NAMES.has(t) && !isWhitelistedFruitOrProduct(t)) return true;
    if (PLACE_NAMES.has(t)) return true;
  }

  return false;
}

/** Reči koje liče na ime ali su uobičajeni proizvod / sorta */
function isWhitelistedFruitOrProduct(t: string): boolean {
  const ok = new Set([
    "dunja", "jabuka", "kajsija", "sljiva", "šljiva", "malina", "kupina", "visnja", "višnja",
    "kruska", "kruška", "viljamovka", "loza", "grozdje", "grožđe", "orah", "med", "trava",
  ]);
  return ok.has(t);
}

export type ReviewTextAnalysis = {
  /** ako false, ne sme se poslati ocena uopšte */
  allowed: boolean;
  /** za prikaz korisniku */
  userMessage?: string;
  /** za moderaciju ako ikad dozvolimo „sa flagom“ */
  isFlagged: boolean;
  flagReason: string | null;
};

/**
 * Striktna provera pre slanja: zabranjeno PII, imena, mesta, psovke, telefon, email.
 */
export function analyzeReviewText(text: string): ReviewTextAnalysis {
  const raw = text.trim();
  if (!raw) {
    return { allowed: true, isFlagged: false, flagReason: null };
  }

  const lower = raw.toLowerCase();

  if (hasBadWord(lower)) {
    return {
      allowed: false,
      userMessage: "Tekst sadrži neprimerene reči. Uklonite uvredljiv sadržaj.",
      isFlagged: true,
      flagReason: "Sadrži neprimerene reči",
    };
  }

  if (hasEmail(raw)) {
    return {
      allowed: false,
      userMessage: "Ne smete unositi e-mail adresu. Ocena mora biti anonimna.",
      isFlagged: true,
      flagReason: "E-mail (PII)",
    };
  }

  if (hasPhone(raw)) {
    return {
      allowed: false,
      userMessage: "Ne smete unositi broj telefona. Ocena mora biti anonimna.",
      isFlagged: true,
      flagReason: "Telefon (PII)",
    };
  }

  if (hasLikelyFullNameOrNameWithPlace(raw)) {
    return {
      allowed: false,
      userMessage:
        "Ne smeju se pojavljivati lična imena, prezimena ni nazivi mesta (grad, region). Napišite utisak bez identifikacije.",
      isFlagged: true,
      flagReason: "Moguće ime ili mesto (anonimnost)",
    };
  }

  return { allowed: true, isFlagged: false, flagReason: null };
}
