/**
 * Incident mode: hard-disabled to stop write amplification from heartbeat presence updates.
 * Re-enable only after Firestore usage is stabilized and explicitly validated.
 */
export const DISABLE_ONLINE_PRESENCE_TRACKING = true;

export const initPresenceTracking = () => {
  // Presence tracking is intentionally disabled during incident stabilization.
  return () => {};
};
