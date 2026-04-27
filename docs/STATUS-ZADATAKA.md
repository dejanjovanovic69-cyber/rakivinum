# Rakivinum - status zadataka i "gde smo stali"

**Poslednji zapis:** 2026-04-27 — **`Admin` dodavanje/izmena destilerije:** `handleAddDistillery` više ne radi `refetchQueries` na `core-bundle`; lista destilerija u kešu se ažurira `setQueryData` (nova stavka ili merge polja, uključujući brisanje `mapsUrl` / `email` u kešu kad Firestore dobija `deleteField`). Ostaje ručno „Osveži“ i `invalidateAdminProducts()` za agregate / masovne izmene proizvoda.

Ovaj fajl sluzi da **sledeci put** odmah znas sta je uradjeno i sta ostaje, bez kopanja po cetu. Azuriraj ga ukratko posle vecih promena.

**Sta da napises Cursoru na pocetku sledeceg rada:**  
"Prvo procitaj `AGENTS.md` i `docs/STATUS-ZADATAKA.md`, pa nastavi od tamo."

**Brza lokalna provera (bez eksternih testera):**  
`npm run cf:smoke:edge` (proverava health + glavne public Worker rute i vraca status/latenciju/payload size).

**Resilient deploy (kad Cloudflare vrati 500/10500):**  
`npm run cf:deploy:resilient` (retry Worker deploy + Pages deploy sa `functions` workaround-om).

**Standard od sada (read/write):**
- Javni read ide **Worker-first** (`/api/public/*`) uz edge/KV keš; frontend ne radi “sirove” velike Firestore list upite gde postoji Worker ruta.
- Write forme idu preko **Worker write-proxy** (validacija, throttling/debounce idempotency, pa jedan čist Firestore REST upis).
- Posle write-a radi se **cache invalidation** za pogođene javne ključeve/rute da korisnici vide sveže stanje bez read-storma.

## Post-incident smernice (Community / read-storm)

- **Status:** incident sa prekomernim read-ovima je klasifikovan kao kombinacija React state-race + neadekvatnog fetching obrasca za složen ekran.
- **1) useEffect za data fetching:** dugoročno izbaciti ručni efekat-obrazac za mrežu iz složenih stranica; preći na `TanStack Query` (ili `SWR`) za dedupe, retry/cancel, stale policy i cache lifecycle.
- **2) Hook lint pravila kao build-gate:** obavezno uključiti i zaključati `eslint-plugin-react-hooks` sa `react-hooks/exhaustive-deps: "error"` i `react-hooks/rules-of-hooks: "error"` (build treba da padne na kršenje).
- **3) Memoizacija referentnih tipova:** objekti/nizovi/funkcije koji ulaze u hook zavisnosti moraju biti stabilni (`useMemo`/`useCallback`) ili izvučeni van komponente.
- **4) Klijentski circuit-breaker:** u `dataService` dodati globalni osigurač po endpointu (npr. max 3 poziva/s, zatim cooldown 5s) da se spreči read-storm i pri frontend regresiji.
- **5) URL kao izvor istine:** minimizovati sinhronizaciju URL <-> lokalni state kroz efekte; gde je moguće čitati `location.search` direktno u render toku i izbeći waterfall setState cikluse.
- **6) Strict Mode-safe fetching:** ne koristiti `...FetchSentRef` obrasce koji blokiraju remount tok; koristiti request-token/abort obrasce gde samo poslednji aktivni zahtev sme da upiše state.

## PLAN DO SUTRA - 10 PRAVILA (BLOCKER RECOVERY)

Status: **deploy pauza** dok je nalog blokiran; radi se samo stabilizacija koda + lokalne provere.

1. **Napustiti manuelni `useEffect` data-fetch obrazac na kritičnim ekranima**
   - Uvesti `TanStack Query` (ili `SWR`) kao standard za async state.
   - `dataService` ostaje čist transport sloj (bez UI lifecycle logike).

2. **Hook lint kao obavezni quality gate**
   - `react-hooks/rules-of-hooks = error`
   - `react-hooks/exhaustive-deps = error`
   - `lint` mora oboriti build na kršenje.

3. **Memoizacija referentnih tipova**
   - Svaki objekat/niz/funkcija u hook deps mora biti `useMemo`/`useCallback` ili izvučen van komponente.
   - Zabraniti inline `init/options` objekte u fetch hook pozivima.

4. **Klijentski Circuit Breaker**
   - Globalni osigurač po endpointu (max 3 poziva/s + cooldown 5s).
   - Aktivno za sve edge read helper funkcije.

5. **URL decoupling / Single Source of Truth**
   - URL parametri se čitaju kao primarni izvor istine.
   - Smanjiti efekat-sinhronizaciju URL -> local state gde nije neophodno.

6. **Strict Mode-safe effect pattern**
   - Zabranjeni `...FetchSentRef` lock obrasci.
   - Dozvoljen request-token / abort / latest-request-only obrazac.

7. **Fallback izolacija (Firestore zaštita)**
   - Javni tokovi ostaju Worker/KV-first.
   - Firestore fallback samo eksplicitno kroz feature flag i samo gde je nužno.

8. **Read budget hard-cap po ekranu**
   - Lista upiti ostaju hard-capovani.
   - Uvesti i per-screen budžet (npr. prekid daljih read pokušaja kada se pređe prag u jednom lifecycle ciklusu).

9. **PWA/SW politika za rizične rute**
   - `/community` mora izbeći frozen navigate cache scenarije.
   - Držati jasna pravila za `NetworkFirst`/denylist po ruti i auditirati ih.

10. **Incident observability i runbook**
   - Standardizovati debug marker-e za efekte/fetch tokove (count + source + route).
   - Imati gotov incident runbook: “stop-the-bleed” prekidači + rollback redosled.

### Prioritet implementacije (redom)
- **P0 danas:** 2, 4, 6, 7
- **P1 danas/večeras:** 3, 5, 8
- **P2 sutra ujutru:** 1, 9, 10

## DODATNIH 5 ARHITEKTONSKIH SAVETA (potvrđeno)

1. **Razbijanje "God komponente" (`Community.tsx`)**
   - `Community.tsx` treba svesti na tab/router shell.
   - Svaki tab prebaciti u zasebnu komponentu (`ReviewsTab`, `CompareTab`, `SearchTab`, `EventsTab`, `TopTab`, `ProducersTab`).
   - Cilj: manji render obim i manji CPU pritisak na telefonu.

2. **`useMemo` za skupe filtere i derivacije**
   - Teške iteracije (`filteredProducts`, `filteredDistilleries`, compare pool/filteri) obavezno obmotati u `useMemo`.
   - Cilj: izbeći ponovno računanje pri svakom sitnom render okidaču.

3. **Thundering Herd zaštita (fallback disciplina)**
   - Cloudflare Worker ostaje jedini javni ulaz za bazu.
   - Kada edge podbaci, prioritet je lokalni cache + korisnička poruka, a ne masovni direktni fallback ka Firestore-u.
   - Direktni fallback ostaje strogo kontrolisan i iza feature flag-a.

4. **Rate limit backend memorije (Worker map state)**
   - Trenutni in-memory limiter je privremen i best-effort.
   - Za produkciju planirati prelaz na robustniji sloj (Cloudflare Rate Limiting / Durable Objects / KV strategija).
   - Cilj: stabilniji limiter bez nepotrebnog opterećenja memorije izolata.

5. **Storage write optimizacija (`sessionStorage`)**
   - Upise stanja poređenja ne raditi na svako slovo bez kontrole.
   - Uvesti debounce (npr. 400-500ms) ili write-on-intent (na izbor artikla / izlaz sa taba).
   - Cilj: manje "micro-stutter" ponašanja na slabijim uređajima.

### Prioritet za ovih 5 stavki
- **P0:** 1, 2, 3
- **P1:** 5
- **P2:** 4

---

## Gde smo stigli (kratko)

- **Cloudflare Pages (Faza 1):** produkcioni deploy radi na `rakivinum.pages.dev`; rutiranje i `F5` rade ispravno.
- **Firestore stabilizacija:** permission-denied greske su znacajno smanjene kroz fallback-best-effort pristup (`presence`, `guest save`, `scanCount` feature flag).
- **Cache/refresh standard:** centralizovan policy (`cachePolicy.ts`) + uklonjen agresivni interval refresh sa glavnih stranica.
- **Label tok:** uklonjen oslonac na nepostojeci `submitRatingSecure` cloud function po default-u; ostavljen fallback preko Firestore transaction.
- **Label tok (saved check):** dodat lokalni cache stanja "sačuvano" (user/visitor + product) radi smanjenja ponovljenih read-ova pri povratku na etiketu.
- **Label tok (rated-today check):** dodat session cache rezultata dnevne provere ocene (po user/visitor + datum) radi manjeg broja ponovljenih `ratings` read-ova u istoj sesiji.
- **Read optimizacije:** cache-first prosiren na `Home`, `Distillery`, `AdminAudit`, `DistilleryDashboard`, `Collection`; dodat 1h by-id cache u `dataService` (`distillery/product/scanner product`) + dev read-meter (`requestMeter`).
- **Cloudflare Worker (Faza 2 priprema):**
  - Worker deployovan: `https://rakivinum-api.ldjs1969.workers.dev`
  - endpointi spremni: `/health`, `/api/public/distilleries`, `/api/public/products`, `/api/public/community-events`
  - frontend `dataService` ima worker-first + firebase fallback mehanizam.
- **Faza 2 status (VERIFIED):**
  - Worker auth zavrsen preko service account OAuth (JWT) toka.
  - `api/public/*` endpointi vracaju podatke.
  - Pages redeploy uradjen sa ukljucenim `VITE_EDGE_API_BASE`.
  - Korisnicki smoke test prosao (app radi normalno).
- **Faza 3 status (read migracije - TRENUTNI SCOPE ZAVRSEN):**
  - novi endpointi: `/api/public/distillery/:id`, `/api/public/product/:id`, `/api/public/ratings-summary/:productId`
  - `distilleries` i `products` list endpointi vracaju light payload (bez base64 image blob-ova)
  - Worker public GET rute imaju best-effort rate-limit + edge cache
  - `ProductAnalytics` koristi Worker-first summary tok (uz Firebase fallback)
  - `Community` reviews feed koristi Worker-first tok preko `/api/public/ratings-feed` (uz Firebase fallback)
  - `ProductAnalytics` koristi Worker-first i za listu ocena preko `/api/public/product-ratings/:productId` (uz Firebase fallback + 1h client cache)
  - `Home` aktivne akcije/pogodnosti koriste Worker-first tok preko `/api/public/club-actions` (uz Firebase fallback)
  - `Home` clanstva i licenca koriste Worker-first tokove preko `/api/public/club-memberships/:visitorId` i `/api/public/license/:token` (uz Firebase fallback)

- **Firestore / kvota:** `limit()` na upitima, kes/dedup (`dataService`, `resilience`), smanjeni `onSnapshot` gde nije neophodno, `refreshGate` za `focus` burst (`Home`, `Menu`, `Distillery`, itd.).
- **Zajednica (`Community`):** ocene (feed) vise nisu teski `onSnapshot` - kontrolisan `getDocs` + periodicno/fokus osvezavanje + gate.
- **Zajednica (`Community`) P0 refactor (lokalno):** tab UI + data tok su modularizovani (`components/community/*`, `hooks/useCommunityData.ts`, `components/community/{types,constants,utils}.ts`) radi manjeg render opterećenja i lakšeg održavanja/debug-a.
- **Query standard (lokalno uspostavljen):** dodati su `src/lib/queryDefaults.ts` (`stableQueryOptions`) i `src/lib/queryKeys.ts` (centralizovani ključevi). `Community`, `Home` i `Collection` su prebačeni na isti obrazac (`useQuery` + key factory + shared stale/gc policy, bez `refetchOnWindowFocus`).
- **Skener (`Scanner`):** barcode upiti sa `limit`; fallback preko `fetchPublicProducts` (kes/dedup), bez `getDocs` cele `products` kolekcije; direct ID lookup radi samo za `/label/...` i ID-like payload, za numerički barkod se preskače dupli raw barkod upit, a Firestore barcode fallback ide sa `limit(1)`.
- **Pocetna (`Home`):** sacuvano - `getCountFromServer` + poslednji artikal preko `orderBy(createdAt)+limit(1)`; top-ocena ide preko `limit(1)` upita (fallback cap smanjen na `limit(60)` dok index nije spreman).
- **Kolekcija (`Collection`):** ucitavanje sacuvanog sa `limit` (+ `orderBy` za ulogovanog); fallback za product detalje je batched (`documentId in`) umesto pojedinacnih `getDoc`; kada cache postoji koristi se odmah bez automatskog instant refetch-a.
- **Admin / audit / dashboard:** manje real-time slusanje gde je bilo skupo; kontrolisani refresh; prisustvo (online broj) za superadmin; paginacija brisanja proizvoda pri brisanju destilerije.
- **Admin arhiva / verifikacija proizvoda:** masovni update ide **stranicama** sa `orderBy(documentId())` + `startAfter` (ne beskonacna petlja po istom `where`).
- **Destilerija dashboard / analitika modal:** dodatni `limit` na upitima (vlasnik/email destilerije, proizvodi, ocene po chunk-u).
- **Moji klubovi / stranica destilerije:** `limit` na clanstvima i akcijama; napredak u `MyClubs` vise ne radi 2 upita po klubu vec 2 agregatna upita po ekranu (`scans` + `ratings`) sa lokalnim grupisanjem po destileriji; fallback za distilerije je batched (`documentId in`) umesto pojedinacnih `getDoc`.
- **Meni (joined klubovi):** fallback za destilerije je batch (`documentId in`) umesto pojedinacnih `getDoc` poziva kada edge podaci nisu dostupni.
- **Meni / MyClubs (distillery read):** uveden batch helper `fetchPublicDistilleriesByIds` (Worker-first + batched Firestore fallback), manje N pojedinačnih poziva.
- **Meni / MyClubs (distillery read) fix:** prazan edge rezultat (`items: []`) više ne aktivira fallback read ka Firestore-u.
- **Meni / MyClubs (distillery read) dedupe:** ID lista se sortira pre batch zahteva, pa se smanjuju dupli pozivi za isti set destilerija u različitom redosledu.
- **Meni / MyClubs (distillery read) cache:** dodat 1h cache za batch set ID-jeva u `fetchPublicDistilleriesByIds`.
- **Public read hard stop (quota-safe):** u `dataService` direct Firestore fallback za javne read helper-e je podrazumevano isključen; javni tokovi idu Worker/KV-only osim ako se eksplicitno uključi `VITE_ENABLE_FIRESTORE_FALLBACK=1`.
- **Scanner read hardening:** uklonjeni direktni Firestore barcode fallback upiti (`barcodeNormalized/barcode/raw`); lookup ostaje edge-first + cache katalog fallback bez direktnog read udara.
- **MyClubs hot-spot fix:** uklonjeni veliki direktni read upiti nad `scans` i `ratings` pri otvaranju stranice.
- **Home user stats hardening:** ukinut focus/visibility periodični refetch za user stats kako bi se sprečilo ponavljanje read-ova pri navigaciji.
- **Distillery katalog cache:** dodat 1h cache za `fetchPublicProductsByDistilleryId` po distillery/limit kombinaciji.
- **Community / club-actions cache:** dodat 1h cache u `fetchPublicClubActions` (po limitu) i `fetchPublicClubActionsForDistillery` (po distillery/limit kombinaciji).
- **Home/Menu memberships cache:** dodat 1h cache u `fetchPublicClubMembershipsByVisitorId` (po visitor/limit kombinaciji).
- **License token cache:** dodat bezbedniji 10m cache u `fetchPublicLicenseByToken` (po tokenu), da se smanje read-ovi bez dugog zadržavanja potencijalno zastarelog statusa.
- **License negative cache:** dodat 2m negativni cache za `fetchPublicLicenseByToken` kada token ne postoji, da se smanje ponovljeni lookup read-ovi za isti invalidni token.
- **Distillery member-count cache:** dodat 2m cache u `fetchPublicClubMembershipCount` (po distilleryId), uz zadržan lokalni +/- update posle join/leave.
- **Product summary cache:** dodat 10m cache u `fetchPublicProductRatingSummary` (po productId) + kratki 2m negativni cache za miss, da se pri povratku na isti analytics ekran ne ponavlja odmah isti summary read niti isti invalidni `productId` lookup.
- **Scanner barcode negative cache:** dodat 2m negativni cache u `fetchPublicProductByBarcodeLookup` za payload bez rezultata, da ponovljeno skeniranje istog nevalidnog barkoda ne pokreće odmah isti read tok.
- **Edge smoke stabilizacija:** `npm run cf:smoke:edge` prošao (health, distilleries, products, ratings-feed, ratings-summary, product-ratings, club-actions, community-links, products-by-distillery, club-actions-by-distillery, club-membership-count, product-lookup, scan-clusters).
- **Edge empty-list authoritative:** za javne list helper-e (`distilleries/products/events/links/ratings`, `products-by-distillery`, `product-ratings`, `scan-clusters`, `club-actions`, `club-actions-by-distillery`, `club-memberships`) prazan edge odgovor (`[]`) je sada konačan i ne aktivira fallback read ka Firestore-u.
- **By-id negative cache:** `fetchPublicDistilleryById`, `fetchPublicProductById` i `fetchScannerProductById` sada koriste kratki 2m negativni cache za miss/nejavni rezultat, da isti invalidni ID ne ponavlja odmah fallback read.
- **Edge null authoritative (item):** za `fetchPublicDistilleryById`, `fetchPublicProductById`, `fetchScannerProductById`, `fetchPublicProductRatingSummary` i `fetchPublicLicenseByToken`, ako edge uspešno vrati `item: null`, to se tretira kao konačan miss (upisuje se negativni cache i preskače Firestore fallback).
- **Barcode lookup availability-aware cache:** `fetchPublicProductByBarcodeLookup` razlikuje edge nedostupnost od validnog `item: null`, pa se negativni cache (2m) upisuje samo za potvrđen miss, ne za mrežni/edge outage.
- **Membership count payload hardening:** `fetchPublicClubMembershipCount` tolerise broj i kao string (`"0"`, `"12"`), pa kod edge tip varijacija i dalje koristi edge rezultat umesto fallback count read-a.
- **Destilerija (`Distillery`) članstvo:** pri "leave club" koristi se poznat `membershipDocId` (bez dodatnog membership read-a), a posle join/leave broj članova se lokalno koriguje (+/-) umesto trenutnog count read-a.
- **Build / Vite:** `manualChunks` (pdf, charts, firebase, icons), lazy PDF (`jspdf` / `html2canvas` / `qrcode`) na export, route-level `lazy` u `App`.
- **TypeScript:** sirok prolaz smanjenja `any` na kriticnim stranicama (raniji krugovi).
- **Dokumentacija u repou:** ovaj fajl + komentar u `src/lib/refreshGate.ts` koji ovde vodi.
- **Faza 4 (aktivna):** operativna stabilizacija posle Faze 3; menjamo kod samo ako metrika pokaže novo usko grlo.
- **Faza 5 (priprema paralelno):** definisani su SLO/cost/incident/rollback/deploy-gate okviri u `docs/CLOUDFLARE-PHASE5-OPS-GOVERNANCE.md`.
- **Faza 5 templates:** dodati `docs/PHASE5-INCIDENT-REPORT-TEMPLATE.md` i `docs/PHASE5-WEEKLY-OPS-REPORT-TEMPLATE.md` za standardizovan incident i nedeljni operativni reporting.
- **Faza 5 enable checklist:** dodat `docs/PHASE5-ENABLE-CHECKLIST.md` za formalno uključivanje Faze 5 (go/no-go odluka + 14-dnevni follow-up).
- **Faza 5 weekly report #1:** dodat `docs/PHASE5-WEEKLY-OPS-REPORT-2026-04-26.md` kao prvi realan baseline izveštaj.
- **Faza 5 incident drill #1:** dodat `docs/PHASE5-INCIDENT-DRILL-2026-04-26.md` kao prva simulacija incident/rollback odgovora.
- **Faza 5 quality gate evidence #1:** dodat `docs/PHASE5-QUALITY-GATE-RUN-2026-04-26.md` kao dokaz primene lint/build/smoke gate seta.
- **Faza 5 activation snapshot #1:** dodat `docs/PHASE5-ACTIVATION-STATUS-2026-04-26.md` (5/7 gate-ova zatvoreno; preostaju SLO acceptance i budget alert evidence).
- **Faza 5 owner gates how-to:** dodat `docs/PHASE5-OWNER-GATES-HOWTO.md` sa koracima i evidence formatom za zatvaranje preostala 2 gate-a.
- **Edge hotspot monitor:** dodat `scripts/monitor-edge.ps1` + `npm run cf:monitor:edge` za automatsko praćenje najopterećenijih ruta (median/p95, ok-rate, CSV log u `logs/`).
- **Faza 5 ENABLED:** `docs/PHASE5-ENABLE-CHECKLIST.md` ažuriran na 7/7 gate-ova + `GO`; activation snapshot prebačen na `Completed 7/7`.

---

## Obavezno sledeci put (operativa)

0. **Cloudflare trenutno stanje (stabilno):**
   - Pages produkcija je aktivna i stabilna.
   - Worker OAuth auth radi i `VITE_EDGE_API_BASE` je ukljucen u produkciji.
   - Public read saobracaj ide Worker-first gde je pokriven endpointima.

1. **Najbolji sledeci korak (bez rizika):**
   - [ZAVRSENO] Deploy Worker-a sa novim endpointima:
     - `/api/public/distillery/:id`
     - `/api/public/product/:id`
   - [ZAVRSENO] Frontend `Distillery` koristi worker-first tok za profil i katalog proizvoda.
   - [ZAVRSENO] Smoke test prosao (`distilleries -> distillery -> label -> nazad`).
   - [ZAVRSENO] Uveden rate-limit + edge cache na `api/public/*` rutama.
   - [ZAVRSENO] Dodat analytics/public snapshot endpoint (`ratings-summary`).
   - [ZAVRSENO] Migriran jos 1 skupi read tok na Worker-first (`Community` ratings feed).
   - [SLEDECE] Stabilizacija + merenje Firestore usage trenda naredna 24h.
   - [SLEDECE] Samo po potrebi dodavati nove endpoint-e (ako metrika pokaze usko grlo).
   - [ZAVRSENO] Prvi krug audita: Scanner (`fetchScannerProductById`), Menu (clanstva + destilerije + **community_links**), Collection/Home (proizvod preko `fetchPublicProductById`); detalj `docs/FIRESTORE-READ-AUDIT.md`.

2. **Hosting (frontend) na Firebase (legacy fallback):** poslednji uspesan deploy samo hostinga:  
   `firebase deploy --only hosting` -> URL u konzoli projekta (npr. `*.web.app`).  
   Kompletan `firebase deploy --only firestore` ovde moze da padne sa **403 / billing** ako GCP projekat nema ukljuceno naplacivanje za Firestore API - indeksi i pravila onda deploy-uj na projekat gde Firestore vec radi, ili ukljuci billing za taj projekat.

3. **Deploy Firestore indeksa** (dodat u `firestore.indexes.json`):
   - kolekcija `products`: polja `distilleryId` + `__name__` (za admin paginaciju arhive/verifikacije).
   - kolekcija `ratings`: polja `userId` + `rating` (DESC) za jeftin `Home` top-rating upit.
   - Komanda (iz korena projekta):  
     `firebase deploy --only firestore:indexes`  
   - Bez ovoga admin upiti sa `orderBy(documentId())` mogu da prijave *missing index* u konzoli.

4. **Brzi smoke na telefonu** (kad budes na mrezi): Zajednica (tabovi + Pretraga) -> etiketa -> strelica nazad -> skener (1D ako imas primer) -> Meni.

---

## NEXT 5 STEPS (najjednostavnije)

1. **Stabilizacija 24h (bez velikih izmena)**  
   - Pages ostaje aktivan na `rakivinum.pages.dev`.
   - Worker ostaje aktivan za public read rute.

2. **Merenje efekta (Firestore usage pre/posle)**  
   - uporediti trend reads/writes nakon ukljucenja Worker read sloja.

3. **Prosiriti Worker read pokrivenost**  
   - [PRVI KORAK ZAVRSEN] dodat endpoint `distillery/:id` + frontend migracija Distillery read toka.
   - [DODATNO ZAVRSENO] dodat endpoint `product/:id`.
   - [ZAVRSENO] dodat endpoint `ratings-summary/:productId` i verifikovan u produkciji.

4. **Uvesti rate-limit + edge cache pravila po endpointu**  
   - [ZAVRSENO] Worker ima best-effort IP/path rate-limit i edge cache za public GET rute.

5. **Nastavak Faze 3 (postepeno backend odvajanje od Firebase klijenta)**  
   - [ZAVRSENO U TRENUTNOM SCOPE-U] migracija glavnih read tokova na Worker kao default, uz fallback.
   - [ZAVRSENO] `Community` ratings feed prebacen na Worker-first read.
   - [SLEDECE NA REDU] uraditi merenje efekta (reads/writes trend pre/posle) i eventualno jos jedan analytics snapshot endpoint samo ako bude potrebe.

---

## Faza 4 - Operativni checklist (24h)

1. Pokrenuti `npm run cf:smoke:edge` 2-3 puta u razmaku i uporediti median latenciju po ruti.
2. Uporediti Firestore Usage trend (reads/writes) sa prethodnim danom u istom vremenskom prozoru.
3. Pratiti edge greške i fallback signale (ako rastu, identifikovati rutu i payload).
4. Ne uvoditi nove endpointe bez metrikom potvrđenog uskog grla.
5. Posle 24h zaključiti: stabilno / potrebno ciljano podešavanje TTL-a ili jedna nova ruta.

**Prvi baseline (start Faze 4):**
- 3x uzastopni `npm run cf:smoke:edge` prošli bez greške.
- Svi endpointi `Status=200`, bez regresije payload size.
- Trenutni fokus za praćenje: `distilleries` i `ratings-feed` latency trend (zbog povremenih viših spike-ova).

**Checkpoint #2 (isti dan):**
- Dodatna 2x `npm run cf:smoke:edge` prošla bez greške (svi endpointi 200).
- `distilleries`: 2306ms -> 1332ms (spike pa povratak).
- `ratings-feed`: 1473ms -> 1043ms (spike pa povratak).
- Zaključak: za sada nema regresije, nastaviti 24h trend praćenje pre bilo kakvog novog endpoint/tuning zahvata.

**Checkpoint #3 (isti dan):**
- Još 1x `npm run cf:smoke:edge` prošao bez greške (svi endpointi 200).
- `distilleries`: 2459ms (povremeni spike, u skladu sa ranijim obrascem).
- `product-lookup`: 1284ms (jednokratni viši skok, bez greške i bez promene payload-a).
- Zaključak: i dalje nema funkcionalne regresije; fokus ostaje na trend praćenju, ne na hitnom tuningu.

---

## Cursor - Plan & Usage (kada pise 100% Included)

- **Pauza par dana** obicno **ne vraca** ukljucenu kvotu unazad - reset ide po datumu iz **Plan & Usage** ("resets on ..."), ne po "odmoru od alata".
- **Manje / krace Agent sesije** = manje **daljeg** pritiska na kvotu dok god Cursor jos pusta rad; **ne nadoknaduje** ono sto je vec potroseno u tom ciklusu.
- **Mali test da proveris granicu:** jedan **kratak Agent** zadatak (jedna jasna izmena u jednom ili malo fajlova), npr. jedna recenica u `README`, jedna TS greska iz Problems panela, jedno kratko preimenovanje + pozivi. Ako odmah trazi **upgrade / on-demand / limit** -> verovatno si na **tvrdoj** granici za Agent; ako prodje -> jos uvek radi neki rezim, ali stedljivo.
- Za zvanicno stanje naloga i sporije: **Cursor support** + screenshot **Plan & Usage** (ne Firebase).

---

## Pre-sajam - spremnost za ~1000 ljudi (checklist)

Cilj: **pikovi tokom dana** (sajam / guzva u kaficima) bez pada zbog **Spark kvote** i bez iznenadjenja na racunu. Kod je vec vucen ka manje "sumovskim" read-ovima; ovo je **operativa + plan**.

1. **Plan (Blaze):** pre ozbiljnog dogadjaja ukljuci **Blaze** na pravom GCP/Firebase projektu (onaj gde zivi baza i sajt koji ljudi koriste). Spark **50K read / dan** moze da zakuca servis pri piku, i to **nije** isto sto i "bice skuplo".
2. **Zastita od iznenadjenja:** u **Google Cloud -> Billing -> Budgets & alerts** postavi budzet (npr. **10-20 EUR**) + email upozorenje. To ne sprecava naplatu, ali **ranije vidis** skok.
3. **Grupni test pre sajma:** **5-10 telefona** istovremeno isti scenario kao posetioci: sken -> detalj proizvoda -> ocena / omiljeno -> nazad -> meni / zajednica. Trazi **pucanje**, beskonacno ucitavanje, ili konzolu punu gresaka.
4. **Merenje u konzoli:** prati **Firestore -> Usage** (reads / writes / real-time) i po potrebi **Google Cloud -> Monitoring -> Metrics Explorer** za tacniji vremenski opseg. Uzmi u obzir da **usage grafikon** moze malo da odstupa od **Billing** linije - za evre gledaj **Billing report**.
5. **Paralelno sa unosom / devom:** izbegavaj **localhost sa prod Firebase** dok traje javni dogadjaj (ili uopste kad hoces nizak sum) - to je istorijski pravilo **velikih dnevnih read-ova** na grafikonu.
6. **Posle testa:** ako vidis anomaliju (jedan korisnik = hiljade read-ova u minuti), zabelezi vreme + ekran i to adresiraj u kodu (cesto: petlja refetch-a, presirok query, visak `onSnapshot`).

---

## Backlog "kad stignes" (nije blokirajuce)

- Jos jedan prolaz: da li negde ostaje `getDocs` bez `limit` na velikim kolekcijama.
- Provera da li postoje drugi `while` + isti `where` bez kurzora (isti anti-pattern kao ranije na adminu).
- Po zelji: kratki `CHANGELOG` ili git tag posle deploy-a (cisto za tvoju evidenciju).

---

## Kako da znas "dokle smo" ubuduce

1. Otvori **`docs/STATUS-ZADATAKA.md`** (ovaj fajl).
2. U kodu, polazna tacka za anti-burst refetch je **`src/lib/refreshGate.ts`** (u komentaru ispod stoji link na ovaj fajl).

Ako zelis drugaciji naziv ili lokacija (npr. samo `NAPREDAK.md` u korenu), preimenuj i azuriraj jednu referencu u `refreshGate.ts`.



