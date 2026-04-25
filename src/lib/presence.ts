import { auth, db } from "./firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getOrCreateVisitorId } from "./visitorIdentity";

const HEARTBEAT_MS = 25000;

const safeWritePresence = (isOnline: boolean) => {
  void writePresence(isOnline).catch((err) => {
    const code = String((err as { code?: unknown } | null)?.code || "");
    // Presence is best-effort only; do not surface noisy permission errors in runtime.
    if (!code.includes("permission-denied")) {
      console.warn("Presence write skipped:", err);
    }
  });
};

const getPresenceId = () => {
  const uid = auth.currentUser?.uid;
  if (uid) return `u_${uid}`;
  return `v_${getOrCreateVisitorId()}`;
};

const writePresence = async (isOnline: boolean) => {
  const uid = auth.currentUser?.uid || null;
  const email = auth.currentUser?.email || null;
  const visitorId = getOrCreateVisitorId();
  const presenceId = getPresenceId();
  const nowMs = Date.now();

  await setDoc(
    doc(db, "online_presence", presenceId),
    {
      presenceId,
      uid,
      email,
      visitorId,
      isOnline,
      lastSeenMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

export const initPresenceTracking = () => {
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      safeWritePresence(true);
    }, HEARTBEAT_MS);
  };

  const stopHeartbeat = () => {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = null;
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      safeWritePresence(true);
      startHeartbeat();
    } else {
      safeWritePresence(false);
      stopHeartbeat();
    }
  };

  const onBeforeUnload = () => {
    safeWritePresence(false);
  };

  safeWritePresence(true);
  startHeartbeat();

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("beforeunload", onBeforeUnload);

  const unsubscribeUser = auth.onAuthStateChanged(() => {
    safeWritePresence(true);
  });

  return () => {
    stopHeartbeat();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("beforeunload", onBeforeUnload);
    unsubscribeUser();
    safeWritePresence(false);
  };
};
