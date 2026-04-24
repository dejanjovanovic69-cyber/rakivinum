import { addDoc, collection, doc, increment, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { recordScanAchievement } from "./achievements";

const enrichScanLocation = async (lat: number, lng: number) => {
  const fallback = {
    city: "Privatna Konzumacija",
    venueName: "Privatna Konzumacija",
    placeType: "home",
    isPublicVenue: false,
  };
  if (!lat || !lng) return fallback;

  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=sr`
    );
    const data = await res.json();
    const city = data.city || data.locality || data.principalSubdivision || "Nepoznat grad";
    const locality = String(data.locality || "").toLowerCase();
    const principal = String(data.principalSubdivision || "").toLowerCase();
    const informative = Array.isArray(data.localityInfo?.informative) ? data.localityInfo.informative : [];
    const informativeText = informative.map((x: { name?: string }) => String(x?.name || "")).join(" ").toLowerCase();
    const combined = `${locality} ${principal} ${informativeText}`;
    const publicVenueKeywords = ["kafana", "restoran", "restaurant", "bar", "pub", "kafe", "cafe", "hotel"];
    const detectedPublic = publicVenueKeywords.some((k) => combined.includes(k));

    if (!detectedPublic) {
      return {
        city,
        venueName: "Privatna Konzumacija",
        placeType: "home",
        isPublicVenue: false,
      };
    }

    const venueName =
      informative.find((x: { name?: string }) => String(x?.name || "").trim().length > 2)?.name ||
      data.locality ||
      "Javni objekat";

    return {
      city,
      venueName: String(venueName),
      placeType: "venue",
      isPublicVenue: true,
    };
  } catch (e) {
    console.warn("Reverse geocode enrich failed, using private fallback", e);
    return fallback;
  }
};

/**
 * Beleži sken u `scans` i uvećava `products.scanCount`.
 * `source`: barcode_scan (iz skenera) | label_open (direktan link / etiketa u browseru).
 */
export async function logProductScan(
  finalProductId: string,
  finalProductData: { distilleryId?: string; type?: string } | null | undefined,
  source: "barcode_scan" | "label_open"
): Promise<void> {
  try {
    let locationData = { lat: 0, lng: 0 };
    const geoTimeoutMs = 1500;

    if ("geolocation" in navigator) {
      try {
        const pos = await Promise.race([
          new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: geoTimeoutMs });
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("geo-timeout")), geoTimeoutMs)),
        ]);
        locationData = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch (err) {
        console.warn("Geolocation denied/timeout, trying IP fallback", err);
        try {
          const res = await fetch("https://get.geojs.io/v1/ip/geo.json");
          const data = await res.json();
          if (data.latitude && data.longitude) {
            locationData = { lat: parseFloat(data.latitude), lng: parseFloat(data.longitude) };
          }
        } catch (e) {
          console.warn("IP fallback failed", e);
        }
      }
    }

    const visitorId = localStorage.getItem("rakivinum_visitor_id");
    const distilleryId = finalProductData?.distilleryId || null;
    const locationMeta = await enrichScanLocation(locationData.lat, locationData.lng);

    await addDoc(collection(db, "scans"), {
      productId: finalProductId,
      distilleryId: distilleryId || "unknown",
      timestamp: serverTimestamp(),
      visitorId,
      userId: auth.currentUser?.uid || null,
      location: locationData,
      city: locationMeta.city,
      venueName: locationMeta.venueName,
      placeType: locationMeta.placeType,
      isPublicVenue: locationMeta.isPublicVenue,
      source,
    });

    try {
      await updateDoc(doc(db, "products", finalProductId), {
        scanCount: increment(1),
      });
    } catch (e) {
      console.warn("Could not increment scan count", e);
    }

    recordScanAchievement(finalProductData?.type);
  } catch (e) {
    console.warn("logProductScan failed", e);
  }
}
