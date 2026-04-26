# Audit: Firestore read pozivi u `src/` (2026-04-26)

**Update 2026-04-26 (implementirano):** skener (ID + barkod), Menu, Collection, Home, MyClubs, Distillery (proizvodi + članstvo + broj članova), Worker liste (`community-links`, `products-by-distillery`, `club-actions-by-distillery`, **`product-lookup`**, **`club-membership-count`**, **`scan-clusters`**). Detalji u tabelama ispod.

---

Cilj: lista **gde se još direktno čita** Firestore (van centralnog `dataService` fallback-a), prioritet za **Worker-first** migraciju i šta **namerno ostaje** na klijentu.

**Postojeći Worker public GET:**  
`/health`, `/api/public/distilleries`, `/api/public/products`, `/api/public/products-by-distillery/:id`, `/api/public/community-events`, `/api/public/community-links`, `/api/public/ratings-feed`, `/api/public/club-actions`, `/api/public/club-actions-by-distillery/:id`, `/api/public/club-membership-count/:distilleryId`, `/api/public/club-memberships/:visitorId`, `/api/public/license/:token` (samo polja: `id`, `token`, `expiresAt`, `status`, `plan`), `/api/public/distillery/:id`, `/api/public/product/:id`, `/api/public/product-lookup?n=&r=`, `/api/public/ratings-summary/:productId`, `/api/public/product-ratings/:productId`, `/api/public/scan-clusters/:productId`.

**Centralni sloj:** `src/lib/dataService.ts` — Worker-first, zatim `getDoc`/`getDocs` kao fallback + keš.  
Napomena: za public list helper-e prazan edge odgovor (`items: []`) tretira se kao konačan rezultat (fallback se radi samo kada edge nije dostupan/vrati grešku). Za ključne by-id tokove i `license-by-token`, uspešan edge odgovor sa `item: null` takođe je konačan miss (ne pali fallback read).

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
| Barkod | **`fetchPublicProductByBarcodeLookup`** → `/api/public/product-lookup`; ID lookup se radi samo za `/label/...` i ID-like payload, pa se za čiste/nestrukturisane barkod skenove preskaču nepotrebni ID readovi + dupli raw barkod query; za nepostojeći rezultat dodat je kratki negativni cache (2m), ali se upisuje samo kada edge potvrdi `item: null` (ne pri edge nedostupnosti). |

---

### `src/pages/Home.tsx` — **A / B**

| Read | Napomena |
|------|----------|
| `savedItems` + `orderBy` + `limit(1)` | Korisnički podatak — ostaje Firestore. |
| Poslednji sačuvan proizvod | **`fetchPublicProductById`** (1h by-id cache + kratki 2m negativni cache), pa **`getDoc(products/{id})`** ako javni API vrati `null` (npr. neodobren proizvod) — jedan dokument, bez `__name__` upita. |
| `ratings` gde `userId == uid` | Privatno / korisnički — ostaje Firestore; `Home` pokušava top-1 (`orderBy rating desc, limit 1`) uz fallback na ograničen upit (`limit(60)`) dok index nije dostupan. |
| `getCountFromServer` | Brojanje — ostaje Firestore osim novog agregatnog API-ja. |

---

### `src/pages/Menu.tsx` — **B**

| Read | Napomena |
|------|----------|
| `community_links` `limit(80)` | **[Implementirano]** Worker `/api/public/community-links` + `fetchCommunityLinks`. |
| `club_memberships` po `visitorId` | **[Implementirano]** `fetchPublicClubMembershipsByVisitorId` + 1h cache (po visitor/limit kombinaciji). |
| Joined klubovi (distillery podaci) | Koristi se batch helper `fetchPublicDistilleriesByIds` (Worker `/api/public/distilleries-by-ids`), uz batched Firestore fallback (`documentId in`) samo kada edge nije dostupan (prazan edge odgovor je konačan i ne pali fallback readove); ID lista se kanonizuje (sort) radi boljeg dedupe/cache hita + 1h cache za isti set ID-jeva. |
| Distillery lookup po `ownerId` / `email` | Vlasnički tok — ostaje Firestore. |
| Licence u admin delu menija | Osetljivo pisanje + pun dokument — Firestore. |

---

### `src/pages/Collection.tsx` — **B**

| Read | Napomena |
|------|----------|
| `users/.../savedItems`, `guest_saved_items` | Korisnički — Firestore; kada cache postoji (`readCache`), `Collection` više ne radi automatski isti mrežni fetch na svakom ulasku. |
| Enrich proizvoda | **`fetchPublicProductById`**, zatim batched Firestore fallback (`where(documentId(), "in", chunk)`) za stavke koje nisu dostupne kroz public read. |

---

### `src/pages/Label.tsx` — **B** (mešovito)

| Read | Napomena |
|------|----------|
| `guest_saved_items` / `users/.../savedItems` `getDoc` | Korisnički stanje — Firestore; dodat lokalni `saved` cache po korisniku/gostu+proizvodu da se pri povratku na etiketu često izbegne ponovni `getDoc`. |
| `getDocs` na `ratings` (provera postojeće ocene) | Pravila ocene — ostaje Firestore ili privatni endpoint; dodat session cache za dnevni rezultat provere da se pri ponovnom otvaranju etikete u istoj sesiji izbegne isti read. |
| Glavni proizvod / destilerija / reviews | Proizvod: **`fetchScannerProductById`** (1h by-id cache + 2m negativni cache) + iste javne provere (`isApproved`, arhiva, `publicLabelDisabled`); destilerija i ocene preko `dataService` Worker-first. |

---

### `src/pages/ProductAnalytics.tsx` — **B**

| Read | Napomena |
|------|----------|
| Proizvod (zaglavlje KPI) | **`fetchScannerProductById`** (1h by-id cache + 2m negativni cache; bez duplog `getDoc` posle `fetchPublic`). |
| KPI summary (`ratings-summary`) | **`fetchPublicProductRatingSummary`** worker-first + 10m cache po proizvodu, uz 2m negativni cache za miss. |
| `product-ratings` / `scan clusters` | **[Urađeno]** `fetchPublicProductRatings` i `fetchPublicScanClustersByProductId` preko Worker endpointa, uz dodatni 1h client cache u `dataService` da ponovni ulasci ne povlače isti read odmah. |

---

### `src/pages/MyClubs.tsx` — **B**

| Read | Napomena |
|------|----------|
| `club_memberships`, `distilleries`, `club_actions` | **[Delom urađeno]** `fetchPublicClubMembershipsByVisitorId`, `fetchPublicDistilleriesByIds` (+ batched Firestore fallback `documentId in`), `fetchPublicClubActionsForDistillery` (+ 1h cache po distillery/limit kombinaciji). |
| `scans`, `ratings` (napredak po visitoru) | Ostaje Firestore (nema javnog Worker-a), ali je optimizovano na **2 upita ukupno po ekranu** (jedan za `scans`, jedan za `ratings`) umesto 2 upita po klubu/akciji. |

---

### `src/pages/Distillery.tsx` — **B**

| Read | Napomena |
|------|----------|
| Katalog proizvoda | **`fetchPublicProductsByDistilleryId`** worker-first + 1h cache (ista destilerija/limit kombinacija). |
| Članstvo posetioca + broj članova | **`fetchPublicClubMembershipsByVisitorId`**, **`fetchPublicClubMembershipCount`** (kratki 2m cache po distileriji); join/leave i dalje piše u Firestore, “leave” koristi poznat `membershipId`, a posle join/leave broj članova se lokalno +/- koriguje (bez dodatnog count read-a, uz periodični refresh). |

---

### `src/pages/DistilleryDashboard.tsx` — **B / C**

| Read | Napomena |
|------|----------|
| `distilleries` po `ownerId` / `email`, `products`, `ratings`, `scans`, `club_actions`, `club_memberships` | Vlasnički dashboard — tipično ostaje Firestore; opciono Worker sa **service auth** u budućnosti, ne javni GET. |

---

### `src/components/admin/DistilleryAnalyticsModal.tsx` — **C**

| Read | Napomena |
|------|----------|
| Skupi upiti: `products`, `ratings` (uklj. `in` chunk), `club_memberships` | Admin kontekst — ostaje Firestore ili budući zaštićeni backend. |

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
| `getDoc(licenses/{token})` | **Ne zamenjivati** javnim Worker odgovorom za aktivaciju: `toLicenseItem` na edge-u **ne vraća** `activatedDevices`, `maxDevices`, itd. — potrebno za poslovnu logiku. Opciono: poseban **zaštićeni** endpoint kasnije. Za javni `license-by-token` helper uveden je kratki negativni cache (2m) za nepostojeći token, da se ublaže ponovljeni invalid lookup-i. |

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
3. **Collection / Home:** [urađeno] enrich / poslednji artikal preko `dataService` + batched fallback (`documentId in`) gde treba.
4. **ProductAnalytics:** geo skenovi — [urađeno] Worker `scan-clusters`; proizvod preko `fetchScannerProductById`.
5. **`community_links`:** [urađeno] Worker + `fetchCommunityLinks` + Menu.

---

## Šta ne forsirati na javni Worker

- Puna **licenca** za aktivaciju (`Activate`).
- **Admin**, **audit**, **dashboard** vlasnika sa PII i `users` kolekcijom.
- **Korisnički saved** i **lične ocene** bez novog auth modela.

Kraj audita — za ažuriranje statusa projekta vidi `docs/STATUS-ZADATAKA.md`.
