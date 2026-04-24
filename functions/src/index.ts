/**
 * Callable aktivacija licence — Admin SDK zaobilazi klijentska Firestore pravila.
 */
import {initializeApp, getApps} from "firebase-admin/app";
import {FieldValue, getFirestore, Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {createHash} from "crypto";

const NAMED_DB = "ai-studio-e4c0de88-b3b9-42ae-b6be-4bdfddca62ef";

if (!getApps().length) {
  initializeApp();
}
const adminApp = getApps()[0]!;
const db = getFirestore(adminApp, NAMED_DB);
const ADMIN_BYPASS_EMAILS = new Set(["ldjs1969@gmail.com", "office@rakivinum.com"]);

function isAdminBypassEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  return ADMIN_BYPASS_EMAILS.has(email.trim().toLowerCase());
}

function normalizeToken(raw: string): string {
  const s = raw.trim().replace(/\s+/g, "");
  const m = s.match(/^lic_(.+)$/i);
  if (!m) return s;
  return "lic_" + m[1].toUpperCase();
}

export const activateLicense = onCall(
  {region: "us-central1", maxInstances: 10},
  async (request) => {
    const tokenRaw = request.data?.token;
    const visitorIdRaw = request.data?.visitorId;
    if (typeof tokenRaw !== "string" || typeof visitorIdRaw !== "string") {
      throw new HttpsError("invalid-argument", "token i visitorId moraju biti stringovi.");
    }
    const tokenStr = normalizeToken(tokenRaw);
    const vid = visitorIdRaw.trim();
    if (!tokenStr.startsWith("lic_") || vid.length < 2) {
      throw new HttpsError("invalid-argument", "Nevažeći token ili visitorId.");
    }

    const ref = db.collection("licenses").doc(tokenStr);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Licenca ne postoji u bazi.");
    }

    const data = snap.data()!;
    const expiresAt = data.expiresAt as Timestamp | undefined;
    if (expiresAt) {
      const exp = expiresAt.toDate();
      if (exp < new Date()) {
        throw new HttpsError("failed-precondition", "Licenca je istekla.");
      }
    }

    const activatedDevices = Array.isArray(data.activatedDevices) ? (data.activatedDevices as string[]) : [];
    const maxDevices = typeof data.maxDevices === "number" ? data.maxDevices : 3;
    const isAlready = activatedDevices.includes(vid);
    if (!isAlready && activatedDevices.length >= maxDevices) {
      throw new HttpsError(
        "resource-exhausted",
        `Limit od ${maxDevices} uređaja za ovu licencu.`,
      );
    }

    const updatedDevices = isAlready ? activatedDevices : [...activatedDevices, vid];

    const payload: Record<string, unknown> = {
      token: tokenStr,
      clientName: typeof data.clientName === "string" ? data.clientName : "",
      maxDevices: typeof data.maxDevices === "number" ? data.maxDevices : 3,
      // "Used" should mean activated on at least one device.
      isUsed: updatedDevices.length > 0,
      activatedDevices: updatedDevices,
      lastActivatedBy: vid,
      usedAt: FieldValue.serverTimestamp(),
    };
    if (typeof data.type === "string") {
      payload.type = data.type;
    }

    await ref.update(payload);
    logger.info("activateLicense ok", {token: tokenStr});
    return {ok: true as const};
  },
);

export const deactivateLicenseDevice = onCall(
  {region: "us-central1", maxInstances: 10},
  async (request) => {
    const tokenRaw = request.data?.token;
    const visitorIdRaw = request.data?.visitorId;
    if (typeof tokenRaw !== "string" || typeof visitorIdRaw !== "string") {
      throw new HttpsError("invalid-argument", "token i visitorId moraju biti stringovi.");
    }

    const tokenStr = normalizeToken(tokenRaw);
    const vid = visitorIdRaw.trim();
    if (!tokenStr.startsWith("lic_") || vid.length < 2) {
      throw new HttpsError("invalid-argument", "Nevažeći token ili visitorId.");
    }

    const ref = db.collection("licenses").doc(tokenStr);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Licenca ne postoji u bazi.");
    }

    const data = snap.data()!;
    const activatedDevices = Array.isArray(data.activatedDevices) ? (data.activatedDevices as string[]) : [];
    if (!activatedDevices.includes(vid)) {
      return {ok: true as const, alreadyRemoved: true as const};
    }

    const updatedDevices = activatedDevices.filter((d) => d !== vid);
    await ref.update({
      activatedDevices: updatedDevices,
      // If at least one device remains active, license is still considered used.
      isUsed: updatedDevices.length > 0,
      lastDeactivatedBy: vid,
      deactivatedAt: FieldValue.serverTimestamp(),
    });

    logger.info("deactivateLicenseDevice ok", {token: tokenStr});
    return {ok: true as const, alreadyRemoved: false as const};
  },
);

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(input: unknown, max = 240): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function getClientIp(request: unknown): string {
  const req = request as {rawRequest?: {headers?: Record<string, unknown>; ip?: string}};
  const xff = req.rawRequest?.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]?.trim() || "unknown";
  }
  return req.rawRequest?.ip || "unknown";
}

export const submitRatingSecure = onCall(
  {region: "us-central1", maxInstances: 20},
  async (request) => {
    const data = request.data ?? {};
    const productId = normalizeText(data.productId, 120);
    const distilleryId = normalizeText(data.distilleryId, 120) || "unknown";
    const productName = normalizeText(data.productName, 180) || "Proizvod";
    const productImage = normalizeText(data.productImage, 1000) || "";
    const reviewText = normalizeText(data.reviewText, 500);
    const userLocation = normalizeText(data.userLocation, 120);
    const visitorId = normalizeText(data.visitorId, 120);
    const userAgent = normalizeText(data.userAgent, 400) || "unknown";
    const clientFingerprint = normalizeText(data.clientFingerprint, 400) || "";
    const ratingRaw = Number(data.rating);

    if (!productId) {
      throw new HttpsError("invalid-argument", "productId je obavezan.");
    }
    if (!Number.isFinite(ratingRaw) || ratingRaw < 1 || ratingRaw > 5) {
      throw new HttpsError("invalid-argument", "rating mora biti broj od 1 do 5.");
    }
    if (!visitorId && !request.auth?.uid) {
      throw new HttpsError("failed-precondition", "Nedostaje identifikator posetioca.");
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTs = Timestamp.fromDate(startOfToday);
    const uid = request.auth?.uid || null;
    const callerEmail = String(request.auth?.token?.email || "").toLowerCase().trim();
    const allowMultipleRatingsForTesting = isAdminBypassEmail(callerEmail);
    const actorKey = uid ? `uid:${uid}` : `visitor:${visitorId}`;
    const productRef = db.collection("products").doc(productId);

    const existingSameDay = uid ?
      await db.collection("ratings")
        .where("userId", "==", uid)
        .where("createdAt", ">=", todayTs)
        .limit(1)
        .get() :
      await db.collection("ratings")
        .where("visitorId", "==", visitorId)
        .where("createdAt", ">=", todayTs)
        .limit(1)
        .get();
    if (!allowMultipleRatingsForTesting && !existingSameDay.empty) {
      throw new HttpsError("already-exists", "Već postoji jedna ocena za danas.");
    }

    const clientIp = getClientIp(request);
    const ipHash = hashValue(clientIp);
    const fingerprintHash = clientFingerprint ? hashValue(clientFingerprint) : hashValue(`${visitorId || ""}|${userAgent}`);
    if (!allowMultipleRatingsForTesting) {
      const existingByFingerprint = await db.collection("rating_logs")
        .where("fingerprintHash", "==", fingerprintHash)
        .where("createdAt", ">=", todayTs)
        .limit(1)
        .get();
      if (!existingByFingerprint.empty) {
        throw new HttpsError("already-exists", "Već postoji jedna ocena za danas.");
      }
    }
    const blockRefs = [
      db.collection("abuse_blocks").doc(`ip_${ipHash}`),
      db.collection("abuse_blocks").doc(`fp_${fingerprintHash}`),
      visitorId ? db.collection("abuse_blocks").doc(`visitor_${visitorId}`) : null,
    ].filter(Boolean) as FirebaseFirestore.DocumentReference[];
    const blockSnaps = await Promise.all(blockRefs.map((ref) => ref.get()));
    const blockedByRule = blockSnaps.some((snap) => snap.exists && snap.data()?.isBlocked === true);
    if (blockedByRule) {
      throw new HttpsError("permission-denied", "Izvor je privremeno blokiran od strane moderatora.");
    }
    const riskWindowStart = Timestamp.fromDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));

    const riskWindowSnap = await db.collection("rating_logs")
      .where("ipHash", "==", ipHash)
      .where("createdAt", ">=", riskWindowStart)
      .limit(300)
      .get();

    let recentTotal = 0;
    let recentLow = 0;
    riskWindowSnap.forEach((doc) => {
      recentTotal += 1;
      const val = Number(doc.data().rating || 0);
      if (val <= 2) recentLow += 1;
    });

    const thisIsLow = ratingRaw <= 2;
    const projectedTotal = recentTotal + 1;
    const projectedLow = recentLow + (thisIsLow ? 1 : 0);
    const lowRatio = projectedTotal > 0 ? projectedLow / projectedTotal : 0;
    const isSourceSuspicious = projectedTotal >= 5 && lowRatio >= 0.7;

    const ratingRef = db.collection("ratings").doc();
    const logRef = db.collection("rating_logs").doc();

    const result = await db.runTransaction(async (tx) => {
      const productSnap = await tx.get(productRef);
      const productData = productSnap.exists ? productSnap.data() || {} : {};
      const ratingCount = Number(productData.ratingCount || 0);
      const avgRating = Number(productData.averageRating || 0);
      const newRatingCount = ratingCount + 1;
      const newAverageRating = ((avgRating * ratingCount) + ratingRaw) / newRatingCount;

      tx.set(ratingRef, {
        productId,
        distilleryId,
        productName,
        productImage,
        rating: ratingRaw,
        reviewText: reviewText || null,
        userLocation: userLocation || null,
        userName: "Gost",
        userId: uid,
        visitorId: visitorId || null,
        createdAt: FieldValue.serverTimestamp(),
        isFlagged: false,
        isAutoFlagged: false,
        flagReason: null,
      });

      tx.set(logRef, {
        productId,
        productName,
        rating: ratingRaw,
        reviewText: reviewText || null,
        userId: uid,
        visitorId: visitorId || null,
        actorKey,
        userAgent,
        ipHash,
        fingerprintHash,
        userLocation: userLocation || null,
        createdAt: FieldValue.serverTimestamp(),
        timestamp: now.toISOString(),
        isSourceSuspicious,
        risk: {
          windowDays: 7,
          lowRatings: projectedLow,
          totalRatings: projectedTotal,
          lowRatio: Number(lowRatio.toFixed(3)),
        },
      });

      tx.set(productRef, {
        averageRating: newAverageRating,
        ratingCount: newRatingCount,
      }, {merge: true});

      return {newAverageRating, newRatingCount};
    });

    logger.info("submitRatingSecure ok", {
      productId,
      uid: uid || "guest",
      ipHashPrefix: ipHash.slice(0, 8),
      lowRatio: Number(lowRatio.toFixed(3)),
      suspicious: isSourceSuspicious,
    });

    return {
      ok: true as const,
      averageRating: result.newAverageRating,
      ratingCount: result.newRatingCount,
      suspiciousSource: isSourceSuspicious,
    };
  },
);

