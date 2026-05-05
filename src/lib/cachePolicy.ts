export const CACHE_TTL = {
  CATALOG_24H: 24 * 60 * 60 * 1000,
  DISTILLERY_LIST_6H: 6 * 60 * 60 * 1000,
  PRODUCTS_6H: 6 * 60 * 60 * 1000,
  DISTILLERIES_BY_IDS_1H: 60 * 60 * 1000,
  PRODUCTS_BY_IDS_1H: 60 * 60 * 1000,
  PRODUCTS_BY_DISTILLERY_1H: 60 * 60 * 1000,
  CLUB_ACTIONS_1H: 60 * 60 * 1000,
  CLUB_ACTIONS_BY_DISTILLERY_1H: 60 * 60 * 1000,
  CLUB_MEMBERSHIPS_1H: 60 * 60 * 1000,
  LICENSE_BY_TOKEN_10M: 10 * 60 * 1000,
  LICENSE_BY_TOKEN_NEGATIVE_2M: 2 * 60 * 1000,
  BARCODE_LOOKUP_NEGATIVE_2M: 2 * 60 * 1000,
  CLUB_MEMBERSHIP_COUNT_2M: 2 * 60 * 1000,
  PRODUCT_RATING_SUMMARY_10M: 10 * 60 * 1000,
  PRODUCT_RATING_SUMMARY_NEGATIVE_2M: 2 * 60 * 1000,
  PUBLIC_BY_ID_1H: 60 * 60 * 1000,
  PUBLIC_BY_ID_NEGATIVE_2M: 2 * 60 * 1000,
  PRODUCT_RATINGS_1H: 60 * 60 * 1000,
  SCAN_CLUSTERS_1H: 60 * 60 * 1000,
  COMMUNITY_EVENTS_6H: 6 * 60 * 60 * 1000,
  HOME_RECOMMENDATIONS_6H: 6 * 60 * 60 * 1000,
  /** Kratko keširanje praznog odgovora kad edge ne vrati JSON — smanjuje ponavljane fetch-e, ne Firestore direktno */
  HOME_RECOMMENDATIONS_EDGE_EMPTY_2M: 2 * 60 * 1000,
  HOME_DISTILLERY_MAP_6H: 6 * 60 * 60 * 1000,
} as const;

export const REFRESH_INTERVAL = {
  USER_LIGHT_1H: 60 * 60 * 1000,
  /** Kratki gate za delove admina gde i dalje želimo češnji osvežaj (npr. brojač prisustva). */
  ADMIN_PANEL_10M: 10 * 60 * 1000,
  /**
   * Admin liste u `localStorage` + isti interval za `shouldRunRefresh` posle keša — jedan „hladan“
   * prolaz, zatim isti dan bez ponovnog Firestore-a pri kliku po tabovima (osim force / isteka 24h).
   */
  ADMIN_PANEL_24H: 24 * 60 * 60 * 1000,
} as const;

