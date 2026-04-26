# Audit: Firestore read pozivi u `src/` (2026-04-26)

**Update 2026-04-26 (implementirano):** skener (ID + barkod), Menu, Collection, Home, MyClubs, Distillery (proizvodi + Älanstvo + broj Älanova), Worker liste (`community-links`, `products-by-distillery`, `club-actions-by-distillery`, **`product-lookup`**, **`club-membership-count`**). Detalji u tabelama ispod.

---

Cilj: lista **gde se joÅ¡ direktno Äita** Firestore (van centralnog `dataService` fallback-a), prioritet za **Worker-first** migraciju i Å¡ta **namerno ostaje** na klijentu.

**PostojeÄ‡i Worker public GET:**  
`/health`, `/api/public/distilleries`, `/api/public/products`, `/api/public/products-by-distillery/:id`, `/api/public/community-events`, `/api/public/community-links`, `/api/public/ratings-feed`, `/api/public/club-actions`, `/api/public/club-actions-by-distillery/:id`, `/api/public/club-membership-count/:distilleryId`, `/api/public/club-memberships/:visitorId`, `/api/public/license/:token` (samo polja: `id`, `token`, `expiresAt`, `status`, `plan`), `/api/public/distillery/:id`, `/api/public/product/:id`, `/api/public/product-lookup?n=&r=`, `/api/public/ratings-summary/:productId`, `/api/public/product-ratings/:productId`.

**Centralni sloj:** `src/lib/dataService.ts` â€” Worker-first, zatim `getDoc`/`getDocs` kao fallback + keÅ¡.

---

## Legenda

| Prioritet | ZnaÄenje |
|-----------|----------|
| **A** | ÄŒesto na javnim rutama ili veliki broj dokumenata po zahtevu â€” utiÄe na troÅ¡ak. |
| **B** | Umereno (ulogovani korisnici, retke stranice). |
| **C** | Admin / osetljivi podaci â€” migracija na Worker zahteva auth ili ostaje Firebase. |

---

## Po fajlu

### `src/lib/dataService.ts`

| Tip | Napomena |
|-----|----------|
| Read | Namerno: fallback kada `VITE_EDGE_API_BASE` nedostaje ili Worker vrati greÅ¡ku. |

---

### `src/pages/Scanner.tsx` â€” **A**

| Read | Napomena / sledeÄ‡i korak |
|------|---------------------------|
| ID | **`fetchScannerProductById`**. |
| Barkod | **`fetchPublicProductByBarcodeLookup`** â†’ `/api/public/product-lookup`, zatim do 3 Firestore upita, pa katalog. |

---

### `src/pages/Home.tsx` â€” **A / B**

| Read | Napomena |
|------|----------|
| `savedItems` + `orderBy` + `limit(1)` | KorisniÄki podatak â€” ostaje Firestore. |
| `products` sa `__name__ == lastId` | Samo za prikaz poslednjeg artikla â€” moguÄ‡e zameniti jednim `fetchPublicProductById` ako je `lastId` uvek javni proizvod. |
| `ratings` gde `userId == uid` | Privatno / korisniÄki â€” ostaje Firestore. |
| `getCountFromServer` | Brojanje â€” ostaje Firestore osim novog agregatnog API-ja. |

---

### `src/pages/Menu.tsx` â€” **B**

| Read | Napomena |
|------|----------|
| `community_links` `limit(80)` | **[Implementirano]** Worker `/api/public/community-links` + `fetchCommunityLinks` u `dataService`; `Menu` koristi worker-first. |
| `club_memberships` po `visitorId` | **Kandidat:** `fetchPublicClubMemberships` / veÄ‡ postoji Worker â€” Menu joÅ¡ koristi direktan `getDocs`. |
| `getDoc(distilleries/{id})` u petlji za meni klubova | **Kandidat:** batch ili `fetchPublicDistilleryById` po ID-u (N upita â†’ N Worker GET sa edge keÅ¡om). |
| Distillery lookup po `ownerId` / `email` | VlasniÄki tok â€” ostaje Firestore. |
| Licence u admin delu menija | Osetljivo pisanje + pun dokument â€” Firestore. |

---

### `src/pages/Collection.tsx` â€” **B**

| Read | Napomena |
|------|----------|
| `users/.../savedItems`, `guest_saved_items` | KorisniÄki â€” Firestore. |
| `getDoc(products/{productId})` za enrich liste | **Kandidat:** `fetchPublicProductById` po ID-u (smanjuje direktne readove kada je Edge aktivan). |

---

### `src/pages/Label.tsx` â€” **B** (meÅ¡ovito)

| Read | Napomena |
|------|----------|
| `guest_saved_items` / `users/.../savedItems` `getDoc` | KorisniÄki stanje â€” Firestore. |
| `getDocs` na `ratings` (provera postojeÄ‡e ocene) | Logika zavisna od pravila â€” ostaje ili zahteva privatni endpoint. |
| Glavni product/distillery/reviews | Trebalo bi da ide preko `dataService` gde je veÄ‡ uvedeno â€” proveriti da li neki edge sluÄaj i dalje forsirano ide na Firestore. |

---

### `src/pages/ProductAnalytics.tsx` â€” **B**

| Read | Napomena |
|------|----------|
| `getDoc(product)` | Samo ako `fetchPublicProductById` vrati `null` â€” OK kao fallback. |
| scan clusters po proizvodu | **[Uradjeno]** `fetchPublicScanClustersByProductId` -> Worker `/api/public/scan-clusters/:productId` (uz fallback). |

---

### `src/pages/MyClubs.tsx` â€” **B**

| Read | Napomena |
|------|----------|
| `club_memberships`, `distilleries`, `club_actions` | **[Delom uraÄ‘eno]** `fetchPublicClubMembershipsByVisitorId`, `fetchPublicDistilleryById` (+ `getDoc` fallback), `fetchPublicClubActionsForDistillery`; napuÅ¡tanje kluba Äita Älanstva preko istog API-ja. |
| `scans`, `ratings` (napredak po visitoru) | Ostaje Firestore (nema javnog Worker-a). |

---

### `src/pages/Distillery.tsx` â€” **B**

| Read | Napomena |
|------|----------|
| Katalog proizvoda | **`fetchPublicProductsByDistilleryId`** worker-first. |
| ÄŒlanstvo posetioca + broj Älanova | **`fetchPublicClubMembershipsByVisitorId`**, **`fetchPublicClubMembershipCount`**; join/leave i dalje piÅ¡e u Firestore. |

---

### `src/pages/DistilleryDashboard.tsx` â€” **B / C**

| Read | Napomena |
|------|----------|
| `distilleries` po `ownerId` / `email`, `products`, `ratings`, `scans`, `club_actions`, `club_memberships` | VlasniÄki dashboard â€” tipiÄno ostaje Firestore; opciono Worker sa **service auth** u buduÄ‡nosti, ne javni GET. |

---

### `src/components/admin/DistilleryAnalyticsModal.tsx` â€” **C**

| Read | Napomena |
|------|----------|
| Skupi upiti: `products`, `ratings` (ukljuÄ. `in` chunk), `club_memberships` | Admin kontekst â€” ostaje Firestore ili buduÄ‡i zaÅ¡tiÄ‡eni backend. |

---

### `src/pages/Admin.tsx` â€” **C**

| Read | Napomena |
|------|----------|
| Masovni listovi: `distilleries`, `products`, `eventProposals`, `community_links`, `community_events`, `ratings`, `blocked_users`, `licenses`, â€¦ | Namerno na Firestore + pravila. Migracija = Cloud Function / Worker sa admin JWT, ne public API. |

---

### `src/pages/AdminAudit.tsx` â€” **C**

| Read | Napomena |
|------|----------|
| `rating_logs`, `users`, `abuse_blocks` | Privatno â€” Firestore. |

---

### `src/pages/Activate.tsx` â€” **B** (ostaje Firebase za pun tok)

| Read | Napomena |
|------|----------|
| `getDoc(licenses/{token})` | **Ne zamenjivati** javnim Worker odgovorom za aktivaciju: `toLicenseItem` na edge-u **ne vraÄ‡a** `activatedDevices`, `maxDevices`, itd. â€” potrebno za poslovnu logiku. Opciono: poseban **zaÅ¡tiÄ‡eni** endpoint kasnije. |

---

### `src/pages/Community.tsx`

| Read | Napomena |
|------|----------|
| `updateDoc` (flag) | Write â€” Firestore. Feed read veÄ‡ Worker-first gde je implementirano. |

---

### `src/lib/presence.ts` / `src/lib/logProductScan.ts`

| Operacija | Napomena |
|-----------|----------|
| `setDoc` / `addDoc` / `updateDoc` | Pisanje â€” nije predmet read-audita. |

---

## Rezime prioriteta za sledeÄ‡i razvoj (samo read / troÅ¡ak)

1. **Scanner:** [uraÄ‘eno] ID + barkod preko Worker-a gde je moguÄ‡e.
2. **Menu:** [uraÄ‘eno] Älanstva, destilerije, community links.
3. **Collection / Home:** [uraÄ‘eno] enrich proizvoda preko `fetchPublicProductById`.
4. **ProductAnalytics:** geo skenovi â€” novi endpoint ili ostaviti kao â€žskupljiâ€œ ali retki ekran.
5. **`community_links`:** [uraÄ‘eno] Worker + `fetchCommunityLinks` + Menu.

---

## Å ta ne forsirati na javni Worker

- Puna **licenca** za aktivaciju (`Activate`).
- **Admin**, **audit**, **dashboard** vlasnika sa PII i `users` kolekcijom.
- **KorisniÄki saved** i **liÄne ocene** bez novog auth modela.

Kraj audita â€” za aÅ¾uriranje statusa projekta vidi `docs/STATUS-ZADATAKA.md`.

