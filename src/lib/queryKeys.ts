export const queryKeys = {
  community: {
    ratings: () => ["community", "ratings"] as const,
    catalog: (productsLimit: number, distilleriesLimit: number) =>
      ["community", "catalog", productsLimit, distilleriesLimit] as const,
    events: (limit: number) => ["community", "events", limit] as const,
  },
  home: {
    clubs: (visitorId: string | null) => ["home", "clubs", visitorId ?? "guest"] as const,
    actions: () => ["home", "actions"] as const,
    distilleryMap: (limit: number) => ["home", "distillery-map", limit] as const,
    recommendations: (productsLimit: number, distilleriesLimit: number) =>
      ["home", "recommendations", productsLimit, distilleriesLimit] as const,
    licenseWarning: () => ["home", "license-warning"] as const,
    userStats: (userId: string | null) => ["home", "user-stats", userId ?? "guest"] as const,
  },
  collection: {
    items: (identity: string, productsMapSize: number) =>
      ["collection", identity, productsMapSize] as const,
  },
  distillery: {
    profile: (id: string) => ["distillery", "profile", id] as const,
    products: (id: string, limit: number) => ["distillery", "products", id, limit] as const,
    membership: (id: string, visitorId: string | null) =>
      ["distillery", "membership", id, visitorId ?? "guest"] as const,
    /** Prefiks za `invalidateQueries` — svi `membership` upiti za datu destileriju (svi visitorId). */
    membershipPrefix: (distilleryId: string) => ["distillery", "membership", distilleryId] as const,
    memberCount: (id: string) => ["distillery", "member-count", id] as const,
  },
  menu: {
    helpLinks: () => ["menu", "help-links"] as const,
    joinedClubs: (visitorId: string | null) => ["menu", "joined-clubs", visitorId ?? "guest"] as const,
  },
  myClubs: {
    scope: () => ["my-clubs"] as const,
    list: (visitorId: string | null) => ["my-clubs", "list", visitorId ?? "guest"] as const,
  },
  scanner: {
    barcodeCatalog: (limit: number) => ["scanner", "barcode-catalog", limit] as const,
  },
  distilleries: {
    list: (limit: number) => ["distilleries", "list", limit] as const,
  },
  productAnalytics: {
    byProductId: (id: string) => ["product-analytics", id] as const,
  },
  label: {
    page: (productId: string) => ["label", "page", productId] as const,
  },
  distilleryDashboard: {
    /** Svi dashboard upiti (core po uid, club actions, member count). */
    scope: () => ["distillery-dashboard"] as const,
    core: (uid: string) => ["distillery-dashboard", "core", uid] as const,
    clubActions: (distilleryId: string) => ["distillery-dashboard", "club-actions", distilleryId] as const,
    clubMembersCount: (distilleryId: string) => ["distillery-dashboard", "club-members-count", distilleryId] as const,
  },
  adminAudit: {
    scope: () => ["admin-audit"] as const,
    bundle: () => ["admin-audit", "bundle"] as const,
  },
  admin: {
    /** Invalidira sve admin TanStack upite (core, moderation, licensing, products). */
    scope: () => ["admin"] as const,
    /** Prefiks za `setQueriesData` nad svim keširanim listama proizvoda u adminu. */
    productsPrefix: () => ["admin", "products"] as const,
    coreBundle: () => ["admin", "core-bundle"] as const,
    moderationBundle: () => ["admin", "moderation-bundle"] as const,
    licensingBundle: () => ["admin", "licensing-bundle"] as const,
    products: (selectedDistilleryId: string, isSuperAdminUser: boolean) =>
      ["admin", "products", selectedDistilleryId, isSuperAdminUser ? "super" : "regular"] as const,
  },
};
