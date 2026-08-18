import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  browserPopupRedirectResolver,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

import { initAppCheck } from "./appCheck";

// Import the Firebase configuration
import firebaseConfig from "../../firebase-applet-config.json";

/** Mora biti ista baza kao u firebase.json deploy (imenovana DB, ne (default)). */
const FIRESTORE_DATABASE_ID =
  "firestoreDatabaseId" in firebaseConfig && typeof firebaseConfig.firestoreDatabaseId === "string"
    ? firebaseConfig.firestoreDatabaseId
    : "ai-studio-e4c0de88-b3b9-42ae-b6be-4bdfddca62ef";

if (import.meta.env.DEV && typeof window !== "undefined") {
  console.info("[Rakivinum] Firebase projectId =", firebaseConfig.projectId, "| Firestore DB =", FIRESTORE_DATABASE_ID);
}

// Initialize Firebase SDK
export const app = initializeApp(firebaseConfig);

/**
 * MORA ostati ovde — između `initializeApp` i prvog `initializeFirestore`/`initializeAuth`.
 * Ako se pomeri niže ili u React kod, prvi upiti odu bez App Check tokena i biće odbijeni
 * čim uključiš enforcement u Firebase konzoli.
 */
initAppCheck(app);

export const db = (() => {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      FIRESTORE_DATABASE_ID,
    );
  } catch (e) {
    console.warn("[Rakivinum] Firestore persistent cache fallback:", e);
    return getFirestore(app, FIRESTORE_DATABASE_ID);
  }
})();
export const auth = initializeAuth(app, {
  persistence: [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
  ],
  popupRedirectResolver: browserPopupRedirectResolver,
});
void setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("[Firebase] setPersistence failed:", err);
});

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  
  const errorJson = JSON.stringify(errInfo);
  console.error("Firestore Error: ", errorJson);
  
  if (errInfo.error.includes("Missing or insufficient permissions")) {
    throw new Error(errorJson);
  } else {
    throw error;
  }
}
