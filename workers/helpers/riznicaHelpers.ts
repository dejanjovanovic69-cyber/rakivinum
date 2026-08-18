type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } };

type FirestoreDoc = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

type FirestoreClient = {
  projectId: string;
  databaseId: string;
  accessToken: string;
};
const RIZNICA_MAX_ITEMS = 300;

export type RiznicaWritePayload = {
  drinkId: string;
  category?: "favoriti" | "specijalna-rezerva" | "za-poklon" | "probano" | null;
  userRating?: number | null;
  notes?: string;
  purchasePrice?: number | null;
  purchaseDate?: string | null;
  shelf?: string;
  position?: number;
  product?: Record<string, unknown> | null;
};

export type PublicRiznicaResult = {
  isPublic: boolean;
  ownerName: string | null;
  ownerHandle: string | null;
  ownerAvatar: string | null;
  items: Array<Record<string, unknown>>;
};

export type RiznicaPrivacySettingsPayload = {
  riznicaPublic: boolean;
  riznicaPublicNotes: boolean;
};

export type RiznicaEnrichedDebug = {
  riznicaDocsRead: number;
  productBatchQueries: number;
  productDocsResolved: number;
  firestoreOpsTotal: number;
};

export type RiznicaListDebug = {
  items: Record<string, unknown>[];
  firestoreOpsTotal: number;
};

function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue || 0);
  if ("doubleValue" in value) return Number(value.doubleValue || 0);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("mapValue" in value) {
    const out: Record<string, unknown> = {};
    const fields = value.mapValue?.fields || {};
    Object.entries(fields).forEach(([k, v]) => {
      out[k] = decodeFirestoreValue(v);
    });
    return out;
  }
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map((v) => decodeFirestoreValue(v));
  return null;
}

function decodeDocument(doc: FirestoreDoc): Record<string, unknown> {
  const id = String(doc.name || "").split("/").pop() || "";
  const out: Record<string, unknown> = { id };
  const fields = doc.fields || {};
  Object.entries(fields).forEach(([k, v]) => {
    out[k] = decodeFirestoreValue(v);
  });
  return out;
}

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function buildDocFields(payload: RiznicaWritePayload, includeAddedAt: boolean): Record<string, FirestoreValue> {
  const nowIso = new Date().toISOString();
  const fields: Record<string, FirestoreValue> = {
    drinkId: toFirestoreValue(payload.drinkId),
    ...(includeAddedAt ? { addedAt: { timestampValue: nowIso } } : {}),
    category: toFirestoreValue(payload.category ?? null),
    userRating: toFirestoreValue(
      typeof payload.userRating === "number" && Number.isFinite(payload.userRating) ? payload.userRating : null,
    ),
    notes: toFirestoreValue(String(payload.notes || "")),
    purchasePrice: toFirestoreValue(
      typeof payload.purchasePrice === "number" && Number.isFinite(payload.purchasePrice) ? payload.purchasePrice : null,
    ),
    purchaseDate: payload.purchaseDate ? { timestampValue: payload.purchaseDate } : { nullValue: null },
    shelf: toFirestoreValue(String(payload.shelf || "polica-1")),
    position: toFirestoreValue(Number.isFinite(Number(payload.position)) ? Number(payload.position) : 0),
  };
  if (payload.product && typeof payload.product === "object") {
    fields.productPayload = toFirestoreValue(JSON.stringify(payload.product));
  }
  return fields;
}

function readStoredProductPayload(row: Record<string, unknown>): Record<string, unknown> | null {
  const raw = row.productPayload;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function docUrl(client: FirestoreClient, path: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(client.projectId)}/databases/${encodeURIComponent(client.databaseId)}/documents/${path}`;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
}

export async function getUserRiznica(client: FirestoreClient, userId: string, pageSize = 120): Promise<Record<string, unknown>[]> {
  const result = await getUserRiznicaWithDebug(client, userId, pageSize);
  return result.items;
}

export async function getUserRiznicaWithDebug(
  client: FirestoreClient,
  userId: string,
  pageSize = 120,
): Promise<RiznicaListDebug> {
  const endpoint = `${docUrl(client, `users/${encodeURIComponent(userId)}/riznica`)}?pageSize=${Math.max(1, Math.min(RIZNICA_MAX_ITEMS, pageSize))}`;
  const res = await fetch(endpoint, { method: "GET", headers: { authorization: `Bearer ${client.accessToken}` } });
  if (res.status === 404) return { items: [], firestoreOpsTotal: 0 };
  if (!res.ok) throw new Error(`riznica_list_failed_${res.status}`);
  const data = (await res.json()) as { documents?: FirestoreDoc[] };
  const docs = (data.documents || []).slice(0, RIZNICA_MAX_ITEMS);
  return {
    items: docs.map((d) => decodeDocument(d)),
    /**
     * Firestore naplaćuje PO DOKUMENTU, ne po HTTP zahtevu. Ranije je ovde stajalo `1`,
     * pa je jedan `listDocuments` koji vrati 300 dokumenata prijavljivao „1 op“ —
     * zbog čega je potrošnja izgledala uredno u logovima, a račun je govorio drugačije.
     */
    firestoreOpsTotal: docs.length,
  };
}

/**
 * Broj stavki u riznici bez čitanja samih dokumenata.
 *
 * `runAggregationQuery` se naplaćuje ~1 read na 1000 poklopljenih index unosa, pa je ovo
 * ~1 read umesto do 300. Koristi se samo za proveru limita — nikad za prikaz podataka.
 */
async function countUserRiznica(client: FirestoreClient, userId: string): Promise<{ count: number; ops: number }> {
  const parent = docUrl(client, `users/${encodeURIComponent(userId)}`);
  const endpoint = `${parent}:runAggregationQuery`;
  const body = {
    structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId: "riznica" }] },
      aggregations: [{ count: {}, alias: "total" }],
    },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(client.accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`riznica_count_failed_${res.status}`);
  const rows = (await res.json()) as Array<{ result?: { aggregateFields?: Record<string, { integerValue?: string; doubleValue?: number }> } }>;
  const total = rows.find((r) => r.result?.aggregateFields)?.result?.aggregateFields?.total;
  const n = total?.integerValue != null ? Number(total.integerValue) : Number(total?.doubleValue || 0);
  return { count: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0, ops: 1 };
}

async function fetchProductsByIdsBatch(
  client: FirestoreClient,
  ids: string[],
): Promise<{ byId: Map<string, Record<string, unknown>>; batchQueries: number }> {
  const safeIds = Array.from(
    new Set(
      ids
        .map((id) => String(id || "").trim())
        .filter((id) => id.length > 0),
    ),
  ).slice(0, 5);
  const byId = new Map<string, Record<string, unknown>>();
  if (safeIds.length === 0) return { byId, batchQueries: 0 };
  const projectId = client.projectId;
  const databaseId = client.databaseId;
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:runQuery`;
  let batchQueries = 0;
  for (let i = 0; i < safeIds.length; i += 5) {
    const chunk = safeIds.slice(i, i + 5);
    const body = {
      structuredQuery: {
        from: [{ collectionId: "products" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "__name__" },
            op: "IN",
            value: {
              arrayValue: {
                values: chunk.map((id) => ({
                  referenceValue: `projects/${projectId}/databases/${databaseId}/documents/products/${id}`,
                })),
              },
            },
          },
        },
      },
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: authHeaders(client.accessToken),
      body: JSON.stringify(body),
    });
    batchQueries += 1;
    if (!res.ok) continue;
    const rows = (await res.json()) as Array<{ document?: FirestoreDoc }>;
    rows.forEach((row) => {
      if (!row.document) return;
      const decoded = decodeDocument(row.document);
      const id = String(decoded.id || "").trim();
      if (!id) return;
      byId.set(id, decoded);
    });
  }
  return { byId, batchQueries };
}

export async function getUserRiznicaEnriched(
  client: FirestoreClient,
  userId: string,
  pageSize = 50,
): Promise<{ items: Record<string, unknown>[]; debug: RiznicaEnrichedDebug }> {
  const listResult = await getUserRiznicaWithDebug(client, userId, pageSize);
  const rows = listResult.items.slice(0, RIZNICA_MAX_ITEMS);
  const items = rows.map((row) => {
    const drinkId = String(row.drinkId || row.id || "").trim();
    const p = readStoredProductPayload(row);
    return {
      ...row,
      drinkId,
      product: p || null,
    };
  });
  const debug: RiznicaEnrichedDebug = {
    riznicaDocsRead: rows.length,
    productBatchQueries: 0,
    productDocsResolved: 0,
    firestoreOpsTotal: listResult.firestoreOpsTotal,
  };
  console.info(`[riznica.enriched] uid=${userId} docs=${debug.riznicaDocsRead} enrichment=payload-only ops=${debug.firestoreOpsTotal}`);
  return { items, debug };
}

export async function addToRiznica(client: FirestoreClient, userId: string, payload: RiznicaWritePayload): Promise<{ firestoreOpsTotal: number }> {
  let firestoreOpsTotal = 0;
  const endpoint = docUrl(client, `users/${encodeURIComponent(userId)}/riznica/${encodeURIComponent(payload.drinkId)}`);
  const existing = await fetch(endpoint, { method: "GET", headers: { authorization: `Bearer ${client.accessToken}` } });
  firestoreOpsTotal += 1;
  if (existing.status === 404) {
    /**
     * Ranije je ovde stajao pun `getUserRiznicaWithDebug(..., RIZNICA_MAX_ITEMS + 1)` —
     * čitanje DO 300 DOKUMENATA samo da bi se prebrojalo koliko ih ima, i to pri svakom
     * čuvanju novog pića. Agregacija radi isti posao za ~1 read.
     */
    const current = await countUserRiznica(client, userId);
    firestoreOpsTotal += current.ops;
    if (current.count >= RIZNICA_MAX_ITEMS) {
      throw new Error("riznica_limit_reached");
    }
  } else if (!existing.ok) {
    throw new Error(`riznica_add_check_failed_${existing.status}`);
  }
  const body = { fields: buildDocFields(payload, true) };
  const res = await fetch(endpoint, { method: "PATCH", headers: authHeaders(client.accessToken), body: JSON.stringify(body) });
  firestoreOpsTotal += 1;
  if (!res.ok) throw new Error(`riznica_add_failed_${res.status}`);
  return { firestoreOpsTotal };
}

export async function updateRiznicaItem(
  client: FirestoreClient,
  userId: string,
  drinkId: string,
  updates: Partial<RiznicaWritePayload>,
): Promise<void> {
  const base: RiznicaWritePayload = { drinkId, ...updates };
  const safeUpdates = { ...updates };
  if (typeof safeUpdates.notes === "string") safeUpdates.notes = safeUpdates.notes.slice(0, 500);
  if (typeof safeUpdates.userRating === "number") {
    safeUpdates.userRating = Math.max(1, Math.min(5, safeUpdates.userRating));
  }
  const fields = buildDocFields({ ...base, ...safeUpdates }, false);
  const keys = Object.keys(safeUpdates).filter((k) => k !== "drinkId");
  if (keys.length === 0) return;
  const url = new URL(docUrl(client, `users/${encodeURIComponent(userId)}/riznica/${encodeURIComponent(drinkId)}`));
  keys.forEach((k) => url.searchParams.append("updateMask.fieldPaths", k));
  const body = { fields };
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: authHeaders(client.accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`riznica_update_failed_${res.status}`);
  return;
}

export async function removeFromRiznica(
  client: FirestoreClient,
  userId: string,
  drinkId: string,
): Promise<{ firestoreOpsTotal: number }> {
  const endpoint = docUrl(client, `users/${encodeURIComponent(userId)}/riznica/${encodeURIComponent(drinkId)}`);
  const res = await fetch(endpoint, { method: "DELETE", headers: { authorization: `Bearer ${client.accessToken}` } });
  if (res.status === 404) return { firestoreOpsTotal: 1 };
  if (!res.ok) throw new Error(`riznica_remove_failed_${res.status}`);
  return { firestoreOpsTotal: 1 };
}

export async function getPublicRiznica(client: FirestoreClient, userId: string): Promise<PublicRiznicaResult> {
  const userEndpoint = docUrl(client, `users/${encodeURIComponent(userId)}`);
  const userRes = await fetch(userEndpoint, { method: "GET", headers: { authorization: `Bearer ${client.accessToken}` } });
  if (userRes.status === 404) {
    return { isPublic: false, ownerName: null, ownerHandle: null, ownerAvatar: null, items: [] };
  }
  if (!userRes.ok) throw new Error(`riznica_public_user_failed_${userRes.status}`);
  const userDoc = decodeDocument((await userRes.json()) as FirestoreDoc);
  const isPublic = userDoc.riznicaPublic === true;
  const ownerName =
    (typeof userDoc.displayName === "string" && userDoc.displayName.trim()) ||
    (typeof userDoc.name === "string" && userDoc.name.trim()) ||
    null;
  const ownerHandle =
    (typeof userDoc.username === "string" && userDoc.username.trim()) ||
    (typeof userDoc.handle === "string" && userDoc.handle.trim()) ||
    null;
  const ownerAvatar =
    (typeof userDoc.photoURL === "string" && userDoc.photoURL.trim()) ||
    (typeof userDoc.avatarUrl === "string" && userDoc.avatarUrl.trim()) ||
    null;
  if (!isPublic) {
    return { isPublic: false, ownerName, ownerHandle, ownerAvatar, items: [] };
  }
  const exposeNotes = userDoc.riznicaPublicNotes === true;
  const rows = await getUserRiznica(client, userId, 200);
  const ids = Array.from(
    new Set(rows.map((r) => String(r.drinkId || r.id || "").trim()).filter((x) => x.length > 0)),
  ).slice(0, 300);
  const { byId: productMap } = await fetchProductsByIdsBatch(client, ids);
  const items = rows
    .map((row) => {
      const drinkId = String(row.drinkId || row.id || "").trim();
      const p = productMap.get(drinkId);
      if (!p) return null;
      return {
        drinkId,
        name: p.name || "",
        type: p.type || "",
        image: p.image || p.bottleImageUrl || null,
        bottleImageUrl: p.bottleImageUrl || null,
        year: p.year ?? p.distilledYear ?? null,
        addedAt: row.addedAt ?? null,
        category: row.category ?? null,
        userRating: row.userRating ?? null,
        notes: exposeNotes ? row.notes ?? "" : "",
        shelf: row.shelf ?? "polica-1",
        position: row.position ?? 0,
      };
    })
    .filter((x): x is Record<string, unknown> => Boolean(x));
  return { isPublic: true, ownerName, ownerHandle, ownerAvatar, items };
}

export async function getRiznicaPrivacySettings(client: FirestoreClient, userId: string): Promise<{
  riznicaPublic: boolean;
  riznicaPublicNotes: boolean;
  riznicaLastSharedAt: string | null;
  firestoreOpsTotal: number;
}> {
  const endpoint = docUrl(client, `users/${encodeURIComponent(userId)}`);
  const res = await fetch(endpoint, { method: "GET", headers: { authorization: `Bearer ${client.accessToken}` } });
  if (res.status === 404) {
    return { riznicaPublic: false, riznicaPublicNotes: false, riznicaLastSharedAt: null, firestoreOpsTotal: 1 };
  }
  if (!res.ok) throw new Error(`riznica_settings_get_failed_${res.status}`);
  const userDoc = decodeDocument((await res.json()) as FirestoreDoc);
  return {
    riznicaPublic: userDoc.riznicaPublic === true,
    riznicaPublicNotes: userDoc.riznicaPublicNotes === true,
    riznicaLastSharedAt: typeof userDoc.riznicaLastSharedAt === "string" ? userDoc.riznicaLastSharedAt : null,
    firestoreOpsTotal: 1,
  };
}

export async function updateRiznicaPrivacySettings(
  client: FirestoreClient,
  userId: string,
  payload: RiznicaPrivacySettingsPayload,
): Promise<{ firestoreOpsTotal: number }> {
  let firestoreOpsTotal = 0;
  const endpoint = new URL(docUrl(client, `users/${encodeURIComponent(userId)}`));
  endpoint.searchParams.append("updateMask.fieldPaths", "riznicaPublic");
  endpoint.searchParams.append("updateMask.fieldPaths", "riznicaPublicNotes");
  endpoint.searchParams.append("updateMask.fieldPaths", "riznicaLastSharedAt");
  const shouldSetSharedAt = payload.riznicaPublic === true;
  const body = {
    fields: {
      riznicaPublic: toFirestoreValue(payload.riznicaPublic === true),
      riznicaPublicNotes: toFirestoreValue(payload.riznicaPublic === true && payload.riznicaPublicNotes === true),
      riznicaLastSharedAt: shouldSetSharedAt ? { timestampValue: new Date().toISOString() } : { nullValue: null },
    },
  };
  let res = await fetch(endpoint.toString(), {
    method: "PATCH",
    headers: authHeaders(client.accessToken),
    body: JSON.stringify(body),
  });
  firestoreOpsTotal += 1;
  // Some accounts may not have users/{uid} doc yet; create minimal doc as fallback.
  if (res.status === 404) {
    res = await fetch(docUrl(client, `users/${encodeURIComponent(userId)}`), {
      method: "PATCH",
      headers: authHeaders(client.accessToken),
      body: JSON.stringify(body),
    });
    firestoreOpsTotal += 1;
  }
  if (!res.ok) throw new Error(`riznica_settings_update_failed_${res.status}`);
  return { firestoreOpsTotal };
}
