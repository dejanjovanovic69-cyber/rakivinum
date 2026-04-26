# Rakivinum - status zadataka i "gde smo stali"

**Poslednji zapis:** 2026-04-26 (popodne++++++++++++++++++++++++++++++++++++++) - `fetchPublicClubMembershipCount` sada prihvata i numerički string count iz edge odgovora (npr. `"12"`), pa se izbegava nepotreban fallback read pri varijacijama tipa payload-a.

Ovaj fajl sluzi da **sledeci put** odmah znas sta je uradjeno i sta ostaje, bez kopanja po cetu. Azuriraj ga ukratko posle vecih promena.

**Sta da napises Cursoru na pocetku sledeceg rada:**  
"Prvo procitaj `AGENTS.md` i `docs/STATUS-ZADATAKA.md`, pa nastavi od tamo."

**Brza lokalna provera (bez eksternih testera):**  
`npm run cf:smoke:edge` (proverava health + glavne public Worker rute i vraca status/latenciju/payload size).

**Resilient deploy (kad Cloudflare vrati 500/10500):**  
`npm run cf:deploy:resilient` (retry Worker deploy + Pages deploy sa `functions` workaround-om).

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



