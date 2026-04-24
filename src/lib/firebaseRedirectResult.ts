import { getRedirectResult, type UserCredential } from "firebase/auth";
import { auth } from "./firebase";

let redirectResultPromise: Promise<UserCredential> | null = null;

/**
 * Firebase redirect handoff must run exactly once per page load.
 * React 18 StrictMode runs effects twice in dev; a second getRedirectResult()
 * breaks the flow (pending redirect is consumed or cleared).
 */
export function getFirebaseRedirectResultOnce(): Promise<UserCredential> {
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth);
  }
  return redirectResultPromise;
}
