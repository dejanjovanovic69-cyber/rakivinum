/**
 * DIJAGNOSTIČKI OMOTAČ oko `firebase/firestore` — broji STVARNO PROČITANE DOKUMENTE.
 *
 * Zašto postoji: Firestore Web SDK sve upite gura kroz jedan multipleksiran WebChannel
 * (`Listen/channel`). U DevTools-u se vidi šačica HTTP zahteva bez obzira na to da li je
 * pročitan 1 ili 1000 dokumenata — pa brojanje zahteva daje lažno nisku sliku potrošnje.
 * Ovaj omotač broji `snapshot.size`, tj. ono što Firestore stvarno naplaćuje.
 *
 * Aktivira se SAMO kada je `VITE_COUNT_FIRESTORE_READS=1` (vidi `vite.config.ts` alias).
 * U normalnom build-u se ne uključuje i nema nikakav uticaj na produkciju.
 *
 * Rezultat: `window.__rvReads` — { total, byPath: {...}, calls: [...] }
 */
export * from "@firebase/firestore";

import {
  getDoc as _getDoc,
  getDocs as _getDocs,
  getCountFromServer as _getCountFromServer,
  onSnapshot as _onSnapshot,
  type DocumentReference,
  type Query,
} from "@firebase/firestore";

type Stats = {
  total: number;
  byPath: Record<string, number>;
  calls: Array<{ kind: string; path: string; docs: number; at: number }>;
};

function stats(): Stats {
  const w = globalThis as unknown as { __rvReads?: Stats };
  if (!w.__rvReads) w.__rvReads = { total: 0, byPath: {}, calls: [] };
  return w.__rvReads;
}

function record(kind: string, path: string, docs: number): void {
  const s = stats();
  s.total += docs;
  s.byPath[path] = (s.byPath[path] || 0) + docs;
  s.calls.push({ kind, path, docs, at: Date.now() });
  console.info(`[rvReads] ${kind} ${path} -> ${docs} dok. (ukupno ${s.total})`);
}

/** Putanja kolekcije bez ID-a dokumenta — da se 50 razlicitih proizvoda ne prikaze kao 50 redova. */
function collectionPathOf(ref: unknown): string {
  const anyRef = ref as { path?: string; _query?: unknown; type?: string };
  if (typeof anyRef?.path === "string") {
    const parts = anyRef.path.split("/");
    return parts.length % 2 === 0 ? parts.slice(0, -1).join("/") : anyRef.path;
  }
  try {
    const q = (ref as { _query?: { path?: { canonicalString?: () => string } } })._query;
    const cs = q?.path?.canonicalString?.();
    if (cs) return cs;
  } catch {
    // ignore
  }
  return "(nepoznato)";
}

export async function getDoc(reference: DocumentReference<unknown>) {
  const snap = await _getDoc(reference as never);
  record("getDoc", collectionPathOf(reference), snap.exists() ? 1 : 0);
  return snap as never;
}

export async function getDocs(query: Query<unknown>) {
  const snap = await _getDocs(query as never);
  record("getDocs", collectionPathOf(query), snap.size);
  return snap as never;
}

export async function getCountFromServer(query: Query<unknown>) {
  const snap = await _getCountFromServer(query as never);
  // count agregacija se naplacuje ~1 read na 1000 poklopljenih index unosa
  record("count", collectionPathOf(query), 1);
  return snap as never;
}

export function onSnapshot(...args: Parameters<typeof _onSnapshot>) {
  console.warn("[rvReads] onSnapshot registrovan — trajni listener, naplacuje se pri svakoj promeni");
  return _onSnapshot(...(args as Parameters<typeof _onSnapshot>));
}
