import { isQuotaSaverActive } from "./quotaSaver";

const QS = isQuotaSaverActive();

export const CACHE_TTL = {
  CATALOG_24H: 24 * 60 * 60 * 1000,
  DISTILLERY_LIST_6H: (QS ? 24 : 6) * 60 * 60 * 1000,
  PRODUCTS_6H: (QS ? 24 : 6) * 60 * 60 * 1000,
  DISTILLERIES_BY_IDS_1H: (QS ? 2 : 1) * 60 * 60 * 1000,
  PRODUCTS_BY_IDS_1H: (QS ? 2 : 1) * 60 * 60 * 1000,
  PRODUCTS_BY_DISTILLERY_1H: (QS ? 2 : 1) * 60 * 60 * 1000,
  CLUB_ACTIONS_1H: 60 * 60 * 1000,
  CLUB_ACTIONS_BY_DISTILLERY_1H: 60 * 60 * 1000,
  CLUB_MEMBERSHIPS_1H: 60 * 60 * 1000,
  LICENSE_BY_TOKEN_10M: (QS ? 30 : 10) * 60 * 1000,
  LICENSE_BY_TOKEN_NEGATIVE_2M: (QS ? 15 : 2) * 60 * 1000,
  BARCODE_LOOKUP_NEGATIVE_2M: (QS ? 15 : 2) * 60 * 1000,
  CLUB_MEMBERSHIP_COUNT_2M: (QS ? 10 : 2) * 60 * 1000,
  PRODUCT_RATING_SUMMARY_10M: (QS ? 30 : 10) * 60 * 1000,
  PRODUCT_RATING_SUMMARY_NEGATIVE_2M: (QS ? 15 : 2) * 60 * 1000,
  PUBLIC_BY_ID_1H: (QS ? 2 : 1) * 60 * 60 * 1000,
  PUBLIC_BY_ID_NEGATIVE_2M: (QS ? 15 : 2) * 60 * 1000,
  PRODUCT_RATINGS_1H: (QS ? 2 : 1) * 60 * 60 * 1000,
  SCAN_CLUSTERS_1H: 60 * 60 * 1000,
  COMMUNITY_EVENTS_6H: (QS ? 12 : 6) * 60 * 60 * 1000,
  HOME_RECOMMENDATIONS_6H: (QS ? 12 : 6) * 60 * 60 * 1000,
  /** Kratko keširanje praznog odgovora kad edge ne vrati JSON — smanjuje ponavljane fetch-e, ne Firestore direktno */
  HOME_RECOMMENDATIONS_EDGE_EMPTY_2M: (QS ? 10 : 2) * 60 * 1000,
  HOME_DISTILLERY_MAP_6H: (QS ? 12 : 6) * 60 * 60 * 1000,
} as const;

/**
 * Worker pravi ključ keša po `limit` parametru (`servePublicCached`, workers/index.ts).
 * Različit `limit` za iste podatke = zaseban ključ = zaseban hladan Firestore miss,
 * i to u sva tri sloja (isolate memorija, KV, Cloudflare Cache API).
 *
 * Zato SVE stranice moraju da traže IDENTIČAN limit za isti katalog. Ne prosleđuj
 * `limitCount` ručno — koristi ove konstante. Filtriranje/sečenje radi UI, ne mreža.
 */
export const PUBLIC_CATALOG_LIMIT = {
  PRODUCTS: 200,
  DISTILLERIES: 200,
} as const;

export const REFRESH_INTERVAL = {
  USER_LIGHT_1H: (QS ? 4 : 1) * 60 * 60 * 1000,
  /**
   * Admin panel cita PRAVO iz Firestore-a — ne prolazi kroz Workera ni njegov keš.
   * Na 10 minuta je znacilo da svako duze zadrzavanje u panelu ponovo povuce sve
   * kartice: distilleries 120 + licenses 120 + events 80 + links 80 + blocked 80
   * + proposals 80 + approvals 80 + flagged 60 + recent 40 + products 50, dakle
   * ~700 dokumenata po ciklusu, iznova svakih deset minuta.
   *
   * Panel koristi jedan covek koji zna kada je nesto promenio, a upisi ionako
   * odmah azuriraju prikaz lokalno. Za svesne podatke tu je dugme „Force Full
   * Refresh“. Zato je osvezavanje sada na 12 sati.
   */
  ADMIN_PANEL_12H: (QS ? 24 : 12) * 60 * 60 * 1000,
} as const;

