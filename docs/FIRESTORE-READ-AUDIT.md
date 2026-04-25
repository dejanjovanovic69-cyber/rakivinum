# Audit: Firestore read pozivi u `src/` (2026-04-26)

**Update 2026-04-26 (implementirano):** skener (ID + barkod), Menu, Collection, Home, MyClubs, Distillery (proizvodi + članstvo + broj članova), Worker liste (`community-links`, `products-by-distillery`, `club-actions-by-distillery`, **`product-lookup`**, **`club-membership-count`**). Detalji u tabelama ispod.

---

Cilj: lista **gde se još direktno čita** Firestore (van centralnog `dataService` fallback-a), prioritet za **Worker-first** migraciju i šta **namerno ostaje** na klijentu.

**Postojeći Worker public GET:**  
`/health`, `/api/public/distilleries`, `/api/public/products`, `/api/public/products-by-distillery/:id`, `/api/public/community-events`, `/api/public/community-links`, `/api/public/ratings-feed`, `/api/public/club-actions`, `/api/public/club-actions-by-distillery/:id`, `/api/public/club-membership-count/:distilleryId`, `/api/public/club-memberships/:visitorId`, `/api/public/license/:token` (samo polja: `id`, `token`, `expiresAt`, `status`, `plan`), `/api/public/distillery/:id`, `/api/public/product/:id`, `/api/public/product-lookup?n=&r=`, `/api/public/ratings-summary/:productId`, `/api/public/product-ratings/:productId`.

**Centralni sloj:** `src/lib/dataService.ts` — Worker-first, zatim `getDoc`/`getDocs` kao fallback + keš.

---

## Legenda

| Prioritet | Značenje |
|-----------|----------|
| **A** | Često na javnim rutama ili veliki broj dokumenata po zahtevu — utiče na trošak. |
| **B** | Umereno (ulogovani korisnici, retke stranice). |
| **C** | Admin / osetljivi podaci — migracija na Worker zahteva auth ili ostaje Firebase. |

---

## Po fajlu

### `src/lib/dataService.ts`

| Tip | Napomena |
|-----|----------|
| Read | Namerno: fallback kada `VITE_EDGE_API_BASE` nedostaje ili Worker vrati grešku. |

---

### `src/pages/Scanner.tsx` — **A**

| Read | Napomena / sledeći korak |
|------|---------------------------|
| ID | **`fetchScannerProductById`**. |
| Barkod | **`fetchPublicProductByBarcodeLookup`** → `/api/public/product-lookup`, zatim do 3 Firestore upita, pa katalog. |

---

### `src/pages/Home.tsx` — **A / B**

| Read | Napomena |
|------|----------|
| `savedItems` + `orderBy` + `limit(1)` | Korisnički podatak — ostaje Firestore. |
| `products` sa `__name__ == lastId` | Samo za prikaz poslednjeg artikla — moguće zameniti jednim `fetchPublicProductById` ako je `lastId` uvek javni proizvod. |
| `ratings` gde `userId == uid` | Privatno / korisnički — ostaje Firestore. |
| `getCountFromServer` | Brojanje — ostaje Firestore osim novog agregatnog API-ja. |

---

### `src/pages/Menu.tsx` — **B**

| Read | Napomena |
|------|----------|
| `community_links` `limit(80)` | **[Implementirano]** Worker `/api/public/community-links` + `fetchCommunityLinks` u `dataService`; `Menu` koristi worker-first. |
| `club_memberships` po `visitorId` | **Kandidat:** `fetchPublicClubMemberships` / već postoji Worker — Menu još koristi direktan `getDocs`. |
| `getDoc(distilleries/{id})` u petlji za meni klubova | **Kandidat:** batch ili `fetchPublicDistilleryById` po ID-u (N upita → N Worker GET sa edge kešom). |
| Distillery lookup po `ownerId` / `email` | Vlasnički tok — ostaje Firestore. |
| Licence u admin delu menija | Osetljivo pisanje + pun dokument — Firestore. |

---

### `src/pages/Collection.tsx` — **B**

| Read | Napomena |
|------|----------|
| `users/.../savedItems`, `guest_saved_items` | Korisnički — Firestore. |
| `getDoc(products/{productId})` za enrich liste | **Kandidat:** `fetchPublicProductById` po ID-u (smanjuje direktne readove kada je Edge aktivan). |

---

### `src/pages/Label.tsx` — **B** (mešovito)

| Read | Napomena |
|------|----------|
| `guest_saved_items` / `users/.../savedItems` `getDoc` | Korisnički stanje — Firestore. |
| `getDocs` na `ratings` (provera postojeće ocene) | Logika zavisna od pravila — ostaje ili zahteva privatni endpoint. |
| Glavni product/distillery/reviews | Trebalo bi da ide preko `dataService` gde je već uvedeno — proveriti da li neki edge slučaj i dalje forsirano ide na Firestore. |

---

### `src/pages/ProductAnalytics.tsx` — **B**

| Read | Napomena |
|------|----------|
| `getDoc(product)` | Samo ako `fetchPublicProductById` vrati `null` — OK kao fallback. |
| `getDocs(scans)` za geo klaster (do 300) | **Kandidat:** zaseban Worker endpoint (agregacija po regionu) ili prihvatiti da ostane zbog security rules. |

---

### `src/pages/MyClubs.tsx` — **B**

| Read | Napomena |
|------|----------|
| `club_memberships`, `distilleries`, `club_actions` | **[Delom urađeno]** `fetchPublicClubMembershipsByVisitorId`, `fetchPublicDistilleryById` (+ `getDoc` fallback), `fetchPublicClubActionsForDistillery`; napuštanje kluba čita članstva preko istog API-ja. |
| `scans`, `ratings` (napredak po visitoru) | Ostaje Firestore (nema javnog Worker-a). |

---

### `src/pages/Distillery.tsx` — **B**

| Read | Napomena |
|------|----------|
| Katalog proizvoda | **`fetchPublicProductsByDistilleryId`** worker-first. |
| Članstvo posetioca + broj članova | **`fetchPublicClubMembershipsByVisitorId`**, **`fetchPublicClubMembershipCount`**; join/leave i dalje piše u Firestore. |

---

### `src/pages/DistilleryDashboard.tsx` — **B / C**

| Read | Napomena |
|------|----------|
| `distilleries` po `ownerId` / `email`, `products`, `ratings`, `scans`, `club_actions`, `club_memberships` | Vlasnički dashboard — tipično ostaje Firestore; opciono Worker sa **service auth** u budućnosti, ne javni GET. |

---

### `src/components/admin/DistilleryAnalyticsModal.tsx` — **C**

| Read | Napomena |
|------|----------|
| Skupi upiti: `products`, `ratings` (uključ. `in` chunk), `club_memberships` | Admin kontekst — ostaje Firestore ili budući zaštićeni backend. |

---

### `src/pages/Admin.tsx` — **C**

| Read | Napomena |
|------|----------|
| Masovni listovi: `distilleries`, `products`, `eventProposals`, `community_links`, `community_events`, `ratings`, `blocked_users`, `licenses`, … | Namerno na Firestore + pravila. Migracija = Cloud Function / Worker sa admin JWT, ne public API. |

---

### `src/pages/AdminAudit.tsx` — **C**

| Read | Napomena |
|------|----------|
| `rating_logs`, `users`, `abuse_blocks` | Privatno — Firestore. |

---

### `src/pages/Activate.tsx` — **B** (ostaje Firebase za pun tok)

| Read | Napomena |
|------|----------|
| `getDoc(licenses/{token})` | **Ne zamenjivati** javnim Worker odgovorom za aktivaciju: `toLicenseItem` na edge-u **ne vraća** `activatedDevices`, `maxDevices`, itd. — potrebno za poslovnu logiku. Opciono: poseban **zaštićeni** endpoint kasnije. |

---

### `src/pages/Community.tsx`

| Read | Napomena |
|------|----------|
| `updateDoc` (flag) | Write — Firestore. Feed read već Worker-first gde je implementirano. |

---

### `src/lib/presence.ts` / `src/lib/logProductScan.ts`

| Operacija | Napomena |
|-----------|----------|
| `setDoc` / `addDoc` / `updateDoc` | Pisanje — nije predmet read-audita. |

---

## Rezime prioriteta za sledeći razvoj (samo read / trošak)

1. **Scanner:** [urađeno] ID + barkod preko Worker-a gde je moguće.
2. **Menu:** [urađeno] članstva, destilerije, community links.
3. **Collection / Home:** [urađeno] enrich proizvoda preko `fetchPublicProductById`.
4. **ProductAnalytics:** geo skenovi — novi endpoint ili ostaviti kao „skuplji“ ali retki ekran.
5. **`community_links`:** [urađeno] Worker + `fetchCommunityLinks` + Menu.

---

## Šta ne forsirati na javni Worker

- Puna **licenca** za aktivaciju (`Activate`).
- **Admin**, **audit**, **dashboard** vlasnika sa PII i `users` kolekcijom.
- **Korisnički saved** i **lične ocene** bez novog auth modela.

Kraj audita — za ažuriranje statusa projekta vidi `docs/STATUS-ZADATAKA.md`.
