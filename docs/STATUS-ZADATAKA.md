# Rakivinum - status zadataka i "gde smo stali"

## OBAVEZAN DEPLOY PROTOKOL (bez maltretiranja sutra)

**Cilj:** svaka izmena ide do javnog `rakivinum.com` (ne završavamo na lokalnom/test bez produkcije).

### 1) Šta se menja gde

- **Frontend UI / stranice / `src/*`** -> build + **Cloudflare Pages deploy** (jer to servira sajt).
- **Edge API / `workers/*`** -> **Cloudflare Worker deploy** (jer to servira `/api/...`).
- Ako si dirao i frontend i worker: deploy-uj **oba**.

### 2) Uvek isti redosled komandi (iz `C:\rakivinum`)

1. `npm run lint`
2. `npm run build`
3. `npm run cf:worker:deploy`
4. `npm run cf:pages:deploy`

`npm run cf:pages:deploy` sada pokreće **`scripts/pages-deploy.ps1`**: privremeno preimenuje Firebase folder **`functions/` → `functions_tmp`** dok Wrangler ne završi upload, jer Wrangler inače tretira root **`functions/`** kao **Cloudflare Pages Functions** i puca na `functions/node_modules/ci-info` (`.d.ts` „must be initialized“). Posle deploy-a folder se vraća na `functions/`.  
**Ne mešati** u isti `wrangler.toml` i **`main`** (Worker) i **`pages_build_output_dir`** — Wrangler to odbija.

### 3) Kako potvrdiš da je stvarno javno

1. Otvori deploy URL koji vrati Pages (`https://<hash>.rakivinum-6gk.pages.dev`) i proveri Home + Menu + Moja Riznica.
2. Otvori `https://rakivinum.com` u Incognito i uradi hard refresh.
3. Proveri iste 3 stranice i da nema starih bundle-a.
4. Tek tada smatraj deploy završenim.

### 4) Pravilo za ubuduće

- Ne stajemo na "radi lokalno" ili "radi na pages preview".
- Završetak zadatka = radi na javnom `rakivinum.com`.

---

## Zapis 2026-05-09 — Javni sajt, Worker, Pages, Firestore (šta se desilo i šta važi)

### Gde živi `rakivinum.com`

- **`rakivinum.com` ide preko Cloudflare Pages** (projekat `rakivinum`, `rakivinum-6gk.pages.dev`, custom domen „+1“). Zaglavlje odgovora često uključuje **`Server: cloudflare`**.
- **`firebase deploy --only hosting`** ažurira **`*.web.app`** (npr. `gen-lang-client-0889534325.web.app`) za taj Firebase projekat — to **nije** isti izvor kao javni domen ako DNS i dalje pokazuje na Cloudflare.
- Posle izmene frontenda: **`npm run build`** → **`npm run cf:pages:deploy`** (ne samo Firebase), pa provera da li **`rakivinum.com`** u HTML-u učitava **isti** `index-….js` kao svež Pages deploy (ne stari hash).

### Dva Worker URL-a (klasična zabuna)

- U bundle-u je ranije bio uključen **`https://rakivinum-api.ldjs1969.workers.dev`** — taj endpoint je vraćao **isečene** liste (npr. 5 destilerija / 5 proizvoda), dok je Worker deploy iz ovog repoa išao na **`https://rakivinum-api.dejanjovanovic69.workers.dev`** (puniji katalog).
- U kodu postoji **`src/lib/edgeApiBase.ts`** (`resolveEdgeApiBase()`): ako je env i dalje **`…ldjs1969.workers.dev`**, klijent preusmerava na kanonski host koji prati `wrangler deploy` iz ovog naloga. **`wrangler.toml` `account_id`** odgovara tom nalogu (subdomen `dejanjovanovic69.workers.dev`).

### Pages: produkcija vs `master.*.pages.dev`

- Ako je svež build vidljiv na **`https://master.rakivinum.pages.dev`**, a **`rakivinum.com`** i koreni **`rakivinum-6gk.pages.dev`** i dalje stari `index-….js`, deploy je verovatno išao u **preview** granu, a **production** slot (custom domen) nije ažuriran.
- U **`package.json`**, `cf:pages:deploy` koristi **`--branch master`** usklađeno sa podešavanjem **Production branch** u Cloudflare Pages (ili koristi **Promote to production** u konzoli za poslednji uspešan deployment).

### Pages deploy i folder `functions/` (Firebase)

- Root **`functions/`** = Firebase Cloud Functions kod; Wrangler ga meša sa **Pages Functions**. Rešenje: **`scripts/pages-deploy.ps1`** (privremeno preimenovanje tokom uploada). **`npm run cf:deploy:resilient`** i dalje može privremeno preimenovati `functions` pre istog deploy koraka.

### Firestore — da li je „pokvareno“

- Ove izmene **ne menjaju šemu podataka** u Firestore-u niti pravila sama po sebi.
- **Broj read-ova može privremeno porasti**: pun katalog umesto isečenog, prazan keš posle deploy-a, više uspešnih edge poziva → više Worker čitanja iz Firestore-a dok se keš ne napuni. To je **očekivano ponašanje**, ne znak oštećenja baze.

### Backup

- Lokalna arhiva: **`backups/`**, skripta **`scripts/backup-project.ps1`**: `npm run backup:local` (izabrani fajlovi), `npm run backup:full` (šire), vidi **`BACKUP_AND_RECOVERY.md`**.

## HITNO — handoff 2026-05-08 (quota „nuklearni“ režim + ne možeš više da testiraš)

**Napomena o „dobroj verziji“:** Agent **nema** posebnu arhivu koda van ovog repozitorijuma. Jedina pouzdana tačka je **`git`** (commitovi na `origin/master`) + ono što je trenutno **lokalno izmenjeno / necommitovano** na mašini.  
**Dodatak (lokalna arhiva):** u repou postoji folder **`backups/`** (množina; **`backup/`** ne postoji). Skripta je `scripts/backup-project.ps1` (`npm run backup:local` / `backup:local:keep30` / `backup:full`); uputstvo u `BACKUP_AND_RECOVERY.md`. U `backups/` se vide snapshoti `rakivinum_backup_daily_*` (često oko **22:00** po timestampu imena). Za povratak kopiraj sadržaj željenog snapshot-a preko projekta (vidi MD).

- **Poslednji commit na grani** (pre sutrašnjeg nastavka proveri `git log -1`): trenutno u sesiji viđeno `c7b71e4` (npr. revert admin fixeva) — **proveri kod sebe** sa `git log -1 --oneline`.
- **Riznica / `workers/helpers/riznicaHelpers.ts`:** veliki deo Riznice je bio **necommitovan** (`?? workers/helpers/`, `?? src/pages/MojaRiznica.tsx`, servisi, tipovi…). Znači „pre Riznice“ u smislu čistog repoa najčešće znači **stanje pre tih lokalnih fajlova**, ne jedan automatski SHA koji agent „pamti“.

### Šta je u poslednjim danima „unakazeno“ (smisao izmena — da bi se lako vratilo sutra)

| Oblast | Fajl (glavni) | Ponašanje |
|--------|----------------|-----------|
| Globalni prekidač | `src/lib/quotaSaver.ts` | `QUOTA_SAVER_MODE` / `FORCE_EDGE_ONLY` ostaju **true**; `HARD_LOCK_SAVED_READS_THRESHOLD` spušten na **1000**. |
| Klijentski limiti | `src/lib/dataService.ts` | `GLOBAL_SAFETY_LIMIT = 5` + `clampGlobalListLimit` na javnim listama (proizvodi, destilerije, događaji, linkovi, ratings feed, klub akcije, članstva, …); stroži fallback capovi gde je bilo veliki `limit(...)` itd. |
| Moji klubovi | `src/pages/MyClubs.tsx` | Ako je `isQuotaSaverActive()` → **odmah** `setClubs([])`, `setIsLoading(false)`, `return` — **nema** Firestore skenova/ratings/memberships/actions. |
| Meni | `src/pages/Menu.tsx` | Članstva u meniju: **24h** `shouldRunRefresh` po visitoru (`menu:clubs:refresh:…`), prvo lokalni merge ID-jeva. |
| Zajednica | `src/pages/Community.tsx` | Ranije: katalog (proizvodi/destilerije) **isključen** u `useEffect` (prazni tabovi Top/Uporedi/… dok se ne vrati). |
| Admin | `src/pages/Admin.tsx` | **Uklonjen** auto `fetchDistilleries()` na mount; dodato dugme **„Osveži destilerije“** kada je lista prazna. |
| Worker liste | `workers/index.ts` | `WORKER_FIRESTORE_LIST_CAP = 5`: `fetchCollection` uvek `pageSize=5`; `fetchCollectionWhereEquals` i `fetchProductsByDistilleryPaged` ograničeni na 5. |
| Riznica helper | `workers/helpers/riznicaHelpers.ts` | `fetchProductsByIdsBatch`: max **5** ID-jeva po pozivu, chunk 5, `runQuery` + `IN`. |
| Ranije u istom nizu | `src/lib/cachePolicy.ts`, `refreshGate.ts`, `requestMeter.ts`, `Community.tsx`, `workers/index.ts` (home-bundle, `servePublicCached` TTL/log), itd. | Delimično dokumentovano u starijim blokovima ispod; detalj u `git diff`. |

**Deploy (mašinski, u toku dana):** Worker verzije koje su spominjane u četu uključuju npr. `ec7dfd54-4d2b-426f-94e9-4b69132c9598` (posle cap-5) — **Firebase hosting** i **Worker** su deploy-ovani sa ovim agresivnim podešavanjima.

### Šta uraditi sutra (kratko)

1. **Odluka:** da li vraćamo **samo** quota/MyClubs/Admin/dataService/Worker cap, ili ceo **lokalni** paket pre Riznice.  
2. **Za tracked fajlove:** `git diff`, `git checkout -- <fajl>` ili vraćanje na konkretan commit (`git log --oneline`).  
3. **Za necommitovanu Riznicu:** nemoj `git clean -fd` dok ne odlučiš — obriše `??` fajlove.  
4. Kad stabilizuješ: vrati razumne limite (npr. `GLOBAL_SAFETY_LIMIT` 10→…), ukloni ran `return` u `MyClubs`, vrati Admin mount `fetchDistilleries` ako treba, Worker `WORKER_FIRESTORE_LIST_CAP` ili samo `fetchCollection` logika, itd.

---

## Spremno za test (Firestore fokus)

**Poslednji zapis:** 2026-05-07 — **Moja Riznica označena kao DONE (100%).**  
- Legacy cleanup: uklonjen stari ekran `src/pages/Collection.tsx`; ruta `/collection` ostaje samo alias redirect ka `/moja-riznica`.  
- Micro UX polish (`MojaRiznica`): naslov sada prikazuje broj stavki (`Moja Riznica (N)`), share sekcija dobila jači QR (veći, border/senka), info tekst za javnost linka/QR-a i jasniji copy feedback (`Link kopiran!` sa ikonom u toast-u).  
- Micro UX polish (`PublicRiznica`): unapređen owner header (izraženiji avatar + bolji naslov), dodat CTA „Nazad na moju riznicu“ kada isti ulogovani korisnik gleda svoj public link, poboljšan fallback za privatnu/nepostojeću riznicu.  
- Terminologija: u `TonightRecommendations` preimenovano „Iz moje kolekcije“ -> „Iz moje Riznice“.  
- Home brza kartica potvrđena i zadržana: „Moja riznica“ (ukupno boca + prosečna ocena, klik ka `/moja-riznica`).  
- Arhitektura ostaje ista: Worker-first + cache-first + refresh gate + privacy toggle tok preko private Worker endpointa.

**Verifikacija (lokalno):**
- `npm run lint` ✅
- `npm run build` ✅
- `npm run cf:smoke:edge` ✅
- Napomena: `npm run build -- --report` nije podržan u trenutnoj Vite CLI konfiguraciji (`Unknown option --report`); korišćen standardni build output za proveru bundle veličina.

**Poslednji zapis:** 2026-05-07 — **Riznica privatnost kontrole (toggle + Worker settings endpoint) implementirane.**  
- Worker: dodat `GET/POST /api/private/riznica/settings` u `workers/index.ts` (auth obavezan, `no-store` headers).  
- Helper: `workers/helpers/riznicaHelpers.ts` proširen sa `getRiznicaPrivacySettings(...)` i `updateRiznicaPrivacySettings(...)` koje upisuju `users/{uid}.riznicaPublic`, `users/{uid}.riznicaPublicNotes`, `users/{uid}.riznicaLastSharedAt`.  
- Frontend servis: `src/services/riznicaService.ts` dobio `getPrivacySettings()` i `updatePrivacySettings(...)`; zadržan Worker-first obrazac i edge metering.  
- UI: `src/pages/MojaRiznica.tsx` dobio sekciju **Deljenje Riznice** (2 toggle-a, copy share link, QR prikaz); `riznicaPublicNotes` je disabled dok `riznicaPublic` nije uključeno.  
- Public stranica: `src/pages/PublicRiznica.tsx` sada prikazuje avatar vlasnika + tekst „Podeljeno od ...“, a public payload nosi i `ownerAvatar`.  
- Menu: dodat ulaz „Privatnost Riznice“ u sekciji podešavanja koji vodi na `/moja-riznica`.

**Verifikacija (lokalno):**
- `npm run lint` ✅
- `npm run build` ✅
- `npm run cf:smoke:edge` ✅

**Poslednji zapis:** 2026-05-07 — **Javna read-only Riznica (`/riznica/:uid`) implementirana.**  
- Worker: dodat `GET /api/public/riznica/:uid` u `workers/index.ts` (servePublicCached, Worker-first public tok).  
- Helper: `workers/helpers/riznicaHelpers.ts` proširen sa `getPublicRiznica(userId)` — vraća samo javne podatke (bez `purchasePrice`, `purchaseDate`; `notes` samo ako `riznicaPublicNotes === true`).  
- Privatnost: ako `users/{uid}.riznicaPublic !== true`, endpoint vraća `isPublic: false` i frontend prikazuje ekran „Riznica je privatna“.  
- Frontend: nova stranica `src/pages/PublicRiznica.tsx` (read-only police + statistike + filter/search, bez drag/edit/remove), rute dodate: `/riznica/:uid` i `/public/riznica/:uid`.  
- PDF/QR: `MojaRiznica` QR sada vodi na javni link `https://rakivinum.pages.dev/riznica/${uid}`.  
- Share meta: dodati osnovni OG tagovi u `index.html`, a `PublicRiznica` dinamički osvežava `og:title/description/url`.  
- Smoke skripta: `scripts/smoke-edge.ps1` dobio opcioni `-SampleRiznicaUserId` za proveru javnog endpointa.

**Verifikacija (lokalno):**
- `npm run lint` ✅
- `npm run build` ✅
- `npm run cf:smoke:edge` ✅
- `npm run test:e2e` ✅

**Poslednji zapis:** 2026-05-07 — **FINALNO poliranje "Moja Riznica" (UX + performanse + Worker disciplina).**  
- `src/pages/MojaRiznica.tsx`: vizuelno unapređene police (jači 3D/senke), poboljšan responsive raspored, moderniji `BottleCard` (kategorija + ikona/boja, ocena, cena, brze akcije), kombinovani search/filter/sort, type-distribution progress bar, offline/info/error stanja i prazan state sa CTA ka skeneru.  
- Drag/drop + touch-friendly drop: kartice su prenosive između polica uz optimistički update (`shelf`, `position`) i Worker sync preko `riznicaService.updateRiznicaItem`.  
- PDF export: unapređen sadržaj (`Moja Riznica - [ime korisnika]`, statistike, grupisanje po policama, datum generisanja).  
- Integracije: Home preusmeren na `/moja-riznica` (umesto stare kolekcije), `Label` koristi `riznicaService` za add/remove/check kod ulogovanih korisnika.  
- Ograničenja/zaštita: limit 300 stavki i dedupe (`drinkId`) sprovedeni na private Worker write helper-u (`workers/helpers/riznicaHelpers.ts`).  
- `src/services/riznicaService.ts`: optimistički cache update za add/update/remove, robustniji edge error mapping (`riznica_limit_reached`), zadržan cache-first read obrazac.  
- Dokumentacija: dopunjen `README.md` sa sekcijom za `Moja Riznica`.

**Verifikacija (lokalno):**
- `npm run lint` ✅
- `npm run build` ✅
- `npm run cf:smoke:edge` ✅
- `npm run test:e2e` ✅ (3/3 smoke scenarija)

**Poslednji zapis:** 2026-05-07 — **Final touch poliranje (premium UX + animacije + PDF+QR + pristupačnost).**  
- `MojaRiznica.tsx`: dodat premium UI polish (stagger fade-in polica, jači 3D shelf slojevi, hover/active lift, touch-friendly horizontal shelf scroll na malim ekranima).  
- `BottleCard`: jasniji category badge (ikonice + tematske boje), dodat feedback za move (`scale/ring`), unapređene tranzicije i edit modal sa laganim ulazom.  
- Stat kartice: dodat count-up efekat (broj boca, prosečna ocena, ukupna vrednost) + unapređen progress prikaz distribucije tipova.  
- Empty state: proširen sa tri CTA akcije (`/scan`, `/distilleries`, `/tonight`).  
- PDF export: profesionalniji sadržaj sa naslovom korisnika, datumom, statistikama, grupisanjem po policama, pokušajem ubacivanja slika (data URL) i QR kodom ka `/moja-riznica`.  
- Toast poruke: unificirani UX feedback (`sačuvano`, `premešteno`, `uklonjeno`, `exportovano`).  
- Accessibility: dodati `aria-label` za drop zone i kartice u polici.  
- Integracije: Home linkovi i copy kompletno prebačeni na Riznicu; `/collection` ruta ostavljena kao alias ka novoj Riznici.  
- Read disciplina: `Label` za ulogovanog korisnika sada koristi `riznicaService` (private Worker tok) za check/add/remove.

**Poslednji zapis:** 2026-05-07 — **Riznica private Worker-first tok završen (read/write endpointi + deploy).**  
- `workers/index.ts`: dodate privatne rute `GET /api/private/riznica`, `POST /api/private/riznica/add`, `POST /api/private/riznica/update`, `POST /api/private/riznica/remove`.  
- Auth: uvedena Bearer verifikacija Firebase ID tokena (tokeninfo + `aud/iss` provera) pre pristupa privatnim rutama.  
- Novi helper: `workers/helpers/riznicaHelpers.ts` (`getUserRiznica`, `addToRiznica`, `updateRiznicaItem`, `removeFromRiznica`) preko Firestore REST API-ja.  
- Klijent: `src/services/riznicaService.ts` sada koristi private Worker endpointe za list/add/update/remove; Firestore direktni fallback je uklonjen za Riznicu (ostaje cache fallback).  
- Smoke: `scripts/smoke-edge.ps1` proširen opcionalnim private proverama (`-SampleAuthToken`), standardni `npm run cf:smoke:edge` prošao.  
- Deploy: `npm run cf:deploy:resilient` uspešan, Worker verzija `a940afc8-f8bb-41d0-a9d5-466862cd915b`; private ruta bez tokena vraća `401` (očekivano).

## Quota Saver Status (2026-05-06)

- **Global mode:** aktivan kroz `src/lib/quotaSaver.ts` (`getCurrentMode`, `getReadSavingEstimate`, local override za superadmin).
- **Admin (strogo):** kada je saver ON, svi teški tab fetch-ovi su cache-only dok se ručno ne klikne `Force Full Refresh`; osnovna lista destilerija i dalje može da se osveži.
- **Monitoring:** dodat `savedReadsToday` brojač u `src/lib/requestMeter.ts`; Admin header prikazuje dnevnu procenu (`Uštedeo: ... reads danas`).
- **Hard Lock:** prag spušten na `10_000` saved reads/dan (lako promenljivo kroz `HARD_LOCK_SAVED_READS_THRESHOLD`); postoji i force override (`ON/OFF/Clear`) za test.
- **Diagnostics panel:** novi superadmin tab `Quota Diagnostics` u `Admin` prikazuje mode, hard lock status, saved reads, top 5 sekcija i kontrolne akcije (`Reset Daily Counter`, `Force Hard Lock`).
- **Diagnostics export:** u `Quota Diagnostics` dodat `Copy Diagnostics JSON` za brzi copy kompletne dijagnostike (`getDiagnostics()`).
- **Global hard-lock ponašanje:** `dataService` preskače i edge fetch helper-e kada je hard lock aktivan (cache-only + warning log).
- **UI signalizacija:** floating badge u donjem desnom uglu prikazuje `Saved: Xk today` (u dev ili saver modu).
- **Cost procena:** `estimatedMonthlyCost` koristi konzervativnu formulu `$0.03 / 100k reads` za realniji forecast.
- **Quota-aware stranice:** pojačani pattern je dodat na `Distillery`, `DistilleryDashboard`, `ProductAnalytics`, `MyClubs`, `Workshop`, `Scanner` (manji limiti, cache-first, saver logovi).
- **Operativni cilj:** sa saver ON aplikacija radi gotovo isključivo iz keša/edge; sa saver OFF vraća se normalan refresh obrazac.

**Kratko uputstvo (superadmin):**
1. Otvori `Admin -> Quota Diagnostics`.
2. Klikni `Reset Daily Counter` pre test sesije.
3. Prođi standardnu korisničku putanju 3-5 min.
4. Proveri `Saved reads`, `Top 5 sekcija`, `Hard Lock` status.
5. Koristi `Copy Diagnostics JSON` za čuvanje snapshot-a pre/posle testa.

**Vodič:** `docs/FIRESTORE-SPIKE-PLAYBOOK.md` — šta Firebase graf meri (uključujući Worker), kad je **0 read/min** normalno, šta očekivati od `ratings-feed` / `home-bundle` na hladnom kešu, **šablon zapisa** kad prijaviš pik, i **sekcija 8** u playbooku (smoke scenario + `x-cache-status` u Network / `__rakivinumEdgeMeterEnable`).

**Worker (`rakivinum-api`, 2026-05-04):** verzija **`a0a45960-a1a2-47ef-9532-f4f0b7192a8e`** — CORS **`x-cache-status`** + **`HOME_BUNDLE_*`** (5.1) + **`RATINGS_FEED_*`** (5.2) + **`PUBLIC_*`** liste / `by-ids` (5.3). **Frontend:** Community / Distilleries keš ključevi i limiti. Detalji: `docs/FIRESTORE-SPIKE-PLAYBOOK.md`.

**Frontend (Firestore / dupli poziv):** `shouldRunRefresh` — **isti ključ** za mount i `focus`/`visibility` gde je isti mrežni tok: `Home.tsx` (`home-bundle`), `Distillery.tsx`, `DistilleryDashboard.tsx` (club panel), `Menu.tsx` (članstva; ako je gate u cooldown-u, samo lokalni `clubs_*` bez novog fetch-a), `AdminAudit.tsx`. Pravilo u `src/lib/refreshGate.ts`. **Deploy (2026-05-04):** Cloudflare Pages `master.rakivinum.pages.dev` + Firebase hosting `gen-lang-client-0889534325.web.app` (isti `dist`); ako `rakivinum.com` ide preko CF, trebalo bi da povuče novi bundle posle propagacije.

---

## Handoff — dokle smo stigli (za sutra)

**Repo / produkcija (poslednja sesija):**  
- **Firestore playbook** (`docs/FIRESTORE-SPIKE-PLAYBOOK.md`): šta graf meri, šablon za pik, **budžeti 5.1–5.3** (`home-bundle`, `ratings-feed`, javni katalozi), **sekcija 8** (smoke + `x-cache-status` / edge meter).  
- **Worker** `a0a45960-…`: CORS `x-cache-status`, manji fan-out (`HOME_BUNDLE_*`, `RATINGS_FEED_*`, `PUBLIC_*`), `by-ids` max 32.  
- **Frontend:** jedan `shouldRunRefresh` ključ gde je trebalo (dupli `home-bundle` fix); Community/Distilleries limiti i novi keš ključevi; deploy Pages + Firebase hosting uz novi `dist`.  
- **Git:** grana `master` — poslednji smisleni commit oko ovoga: `405f5bf` (katalozi); pre toga `86f0455` (ratings-feed), `22a2693` (home-bundle caps), `db8157b` (refresh gate širom stranica), itd.

**Šta možeš sad da testiraš na `rakivinum.com`:**  
1. **Inkognito** ili jedan **hard refresh** (PWA/SW ponekad kešira stari JS).  
2. **Početna → preporuka dana (etiketa) → ocena → nazad** — Firestore minut bi trebalo da bude **niži** nego ranije dupli `home-bundle` (isti scenario ~30+ read umesto duplog paketa).  
3. **Zajednica** — tabovi koji učitavaju katalog (**Tops / Proizvođači / …**): lista je **manja** po hladnom miss-u (120 proizvoda / 100 destilerija cap) — proveri da li UI i dalje izgleda prihvatljivo.  
4. **Destilerije** (spisak): do **100** stavki; pretraga lokalna po učitanom.  
5. Po želji: DevTools → Network → **`x-cache-status`** (`miss-store` prvi put, zatim `cf-hit` / …); konzola `__rakivinumEdgeMeterEnable()` pa reload (vidi playbook 8).

**Šta dalje raditi (sledeći koraci u repou):**  
- **Straničenje** ili „Load more“ za **ceo** katalog proizvoda/destilerija ako treba više od trenutnih cap-ova bez skoka read-ova.  
- **Još Worker ruta** po istom obrascu: `club-actions`, `community_events` / `community_links` — default/max `parseLimit` i konstante u jednom mestu.  
- **Sadržaj u bazi:** proizvodi sa samo **`data:`** slikama — u **Adminu** prebaciti na **HTTPS** (Storage) da budu prave slike posle `sanitizeImageUrl`.  
- **Admin** panel: poseban audit read-ova (već delimično u `FIRESTORE-READ-AUDIT.md`).  
- **Opciono:** Cloudflare **Analytics** za Worker (broj zahteva po ruti) uz Firebase graf.

---

**Poslednji zapis:** 2026-05-07 — **Početak feature-a "Moja Riznica" (Faza 1-3, frontend + servis).**  
**Novo uvedeno:** `src/types/riznica.ts` (model + stats tipovi), `src/services/riznicaService.ts` (cache-first, refreshGate, Worker-first pokušaj na `/api/private/riznica` uz Firestore fallback), nova stranica `src/pages/MojaRiznica.tsx` sa statistikama, policama (polica-1..5), filter/search, kategorijama, cenom i `Export PDF` (print tok).  
**Routing / navigacija:** dodata ruta `/moja-riznica` u `App`, bottom-nav stavka prebačena na "Riznica", Menu kartica preimenovana na "Moja Riznica".  
**Integracija sa etiketom:** `Label.tsx` za ulogovanog korisnika sada upisuje/čita iz `users/{uid}/riznica/{drinkId}` (umesto `savedItems`) i koristi nova polja (`drinkId`, `addedAt`, `category`, `purchasePrice`, ...); guest fallback ostaje netaknut.  
**Tonight preporuke:** kolekcijski pull za ulogovanog korisnika prebačen na `users/{uid}/riznica` (`addedAt`, `drinkId`).  
**Verifikacija:** lokalno prošli `npm run lint` i `npm run build`.  
**Sledeće (otvoreno):** Worker privatna ruta za riznicu (`/api/private/riznica`) trenutno je samo klijentski hook; treba implementirati endpoint + auth verifikaciju za puni Worker-first tok i dodati smoke korak.

---

**Poslednji zapis:** 2026-05-06 — **Stabilizacija posle vraćanja na proverenu admin tačku + ciljane UX ispravke.**  
**Vraćeno stanje (namerno):** ostavljen je admin paket iz `655e93e` (single-flight + lazy tab fetch), a revertovani su kasniji eksperimenti nad gate/TTL (`712242a`, `6050dd8`) kroz commitove `330d62e` i `c7b71e4`.  
**Aktivno trenutno (ponovo dodato po zahtevu):**  
- `Workshop`: tekst „Preporuka odvojiti prvenac“.  
- `Community`: tab font povećan jednoobrazno (`Utisci`, `Top 10`, `Uporedi`, `Destilerije`, `Pretraga`, `Događaji`).  
- `Community` povratak na tab „Utisci“: cache-first prikaz + mrežni fetch samo kad nema važećeg keša ili gate dozvoli (da ne ostaje prazno bez full refresh-a).  
**Debug korelacija (Analytics, ne Firestore query profiler):** dodat minimalni set eventa za DebugView timeline: `community_open`, `dist_dashboard_open`, `admin_tab_switch` (`src/lib/analytics.ts` + pozivi iz relevantnih stranica).  
**Verifikacija/deploy:** više puta odrađeni `npm run lint`, `npm run build`, `npm run cf:smoke:edge`, zatim `npm run cf:deploy:resilient` + `firebase deploy --only hosting`.  
**Trenutni operativni korak:** korisnik danas radi realan „običan korisnik“ test na telefonu; čeka se večernji set Firestore grafova za finalnu potvrdu da je obrazac pikova i dalje prihvatljiv.  

**Poslednji zapis:** 2026-05-05 — **Kritičan read-leak fix (Home + MyClubs) potvrđen u produkciji (stabilan graf).**  
**Worker (`workers/index.ts`)**: za `GET /api/public/home-bundle` izbačen `visitor` iz cache ključa i uklonjen membership fetch iz bundle-a; odgovor sada vraća globalne podatke (`actions`, `daily`, `distilleryNames`) + `memberships: []`, pa Cloudflare cache radi globalno umesto per korisnik.  
**Klijent (`src/lib/dataService.ts`, `src/pages/Home.tsx`)**: `fetchPublicHomeBundle()` je globalan (`homeBundle:global`, `rakivinum_cache_home_bundle_global_v7`) bez query `visitor`; članstva se vuku odvojeno preko `fetchPublicClubMembershipsByVisitorId(visitorId, 30)` (sa lokalnim `clubs_<visitorId>` warm prikazom).  
**MyClubs (`src/pages/MyClubs.tsx`)**: dodato lokalno keširanje progresa skenova/ocena po visitor-u (`rakivinum_cache_myclubs_progress_<visitorId>_v1`) + refresh gate (`myclubs:progress:<visitorId>` / `USER_LIGHT_1H`), pa se pri ulasku na tab ne rade nepotrebni ponovljeni Firestore upiti.  
**Bitan incident tokom verifikacije:** korisnik je na `master.rakivinum.pages.dev` video stari bundle (`home_bundle_*_v6` i `?visitor=`), što je ukazivalo na zastareo frontend artefakt. Rešeno sa svežim `npm run build` + `npm run cf:deploy:resilient`; nakon toga bundle potvrđen kao `homeBundle:global` + `..._v7` bez `?visitor`.  
**Verifikacija/deploy:** `npm run cf:smoke:edge` prošao 14/14 ruta (sve `200`, uključujući `home-bundle`); deploy urađen kroz `npm run cf:deploy:resilient` (Worker + Pages alias `master.rakivinum.pages.dev`).  
**Produkciona potvrda:** Firestore Usage graf posle fix-a pokazuje nizak i stabilan nivo bez velikih ponovljenih pikova (hladan start + manji povremeni hitovi).  
**Operativno pravilo ubuduće (obavezno):** kad se menja keš ključ / dataService tok, uvek uraditi redosled `npm run build` -> `npm run cf:deploy:resilient` -> provera bundle-a na `master.rakivinum.pages.dev` (da više nema starih ključeva / query parametara) -> tek onda validacija na `rakivinum.com`.
**Sledeći paket (Phase 2 — slike):** trenutno je uključen compatibility fallback za `data:image` (Worker + klijent) da korisnici vide slike dok traje migracija podataka. Cilj je migrirati slike na HTTPS (Storage/CDN), pa zatim isključiti fallback (`ALLOW_DATA_IMAGE_FALLBACK = false`) da se smanji payload i stabilizuje performans pod opterećenjem.

**(2026-05-03, kraj sesije)** — **Home „Preporuka dana“ — mala sličica:** Uočeno da produkcioni `home-bundle` za primer proizvoda (`KdFJmcevo3BYOzJUt3c6`) i dalje može vratiti **`bottleImageUrl` kao ogroman `data:...;base64`** (mali `<img>` u Firefoxu često prazan; veliki hero na etiketi može da radi). **U repo-u (lokalno, commitovano):** (1) klijent **`dataService`** — čišćenje `data:` / prevelikih stringova za dnevne proizvode pri parsiranju **i** pri čitanju iz `readCache`; **`pickHttpProductThumbForHome`** + keš ključevi **`home-bundle` `_v5`**, **`daily-recommendations` `_v2`**; (2) **`Home.tsx`** — `HomeDailyThumbImg` koristi taj picker; (3) **Worker** — za dnevni izbor **`toProductListItemWithDailyThumb`**: prvi validan **`galleryImages`** ako nema HTTP u `image`/`bottleImageUrl`; ranije dodato i **logo destilerije** kad oba polja nedostaju nakon stripa. **Git:** `b111771` (logo + swap na grešci), `6dfccfe` (strip base64 na klijentu + gallery na Workeru). **Šta sutra prvo:** deploy **Pages (frontend)** pa provera male sličice; zatim deploy **Workera** da API više ne šalje base64 u javnom JSON-u (lokalni kod već `sanitizeImageUrl` u list helperima — produkcija treba da prati granu); po želji u **Adminu** za problematičan proizvod zameniti base64 **`https://`** (Storage). **Proces:** dogovoriti kratku listu „1 min smoke“ + šta na Firestore grafu očekujemo za taj scenario (korisnik želi jasnije korake, ne samo „mirno je“).

**(2026-05-03, ranije u toku dana)** — **Distillery / katalog:** prvi upit **6** proizvoda (Worker + klijent); sledeće stranice **`?after=<productId>`** + `orderBy(__name__)`; **IntersectionObserver** dopuna pri skrolu; tab „O nama“ bez kataloga; **`fetchPublicProductsByDistilleryId`** default **6**. **Worker `sanitizeImageUrl`:** `data:image/...` se ne šalje u javnom JSON-u u **lokalnom** kodu (list helperi, `home-bundle` / `daily`, itd.). **Dedupe / in-flight:** Promise u mapu **pre** prvog `await`. **Worker `GET /`:** JSON landing. **Zaključak (Worker vs hosting vs Firestore):** odeljak ispod. **Još istog dana:** Community u jedan fajl; Menu / DistilleryDashboard / MyClubs / Admin cache obrasci; detalji u `FIRESTORE-READ-AUDIT.md`.

**Prethodni zapis:** 2026-04-30 (kraj sesije) — **Firestore read spike / sajam priprema:** Admin read-amplification, `DistilleryAnalyticsModal`, `DistilleryDashboard`, `logProductScan` dedupe, slike 400×400, `VITE_DISABLE_ONLINE_PRESENCE`, globalni cap-ovi, deploy Firebase + Worker + Pages.

**Sutra / sledeći koraci (prioritet):** vidi odeljak **„Handoff — dokle smo stigli“** iznad; ukratko: test na produkciji + eventualno straničenje kataloga, cap-ovi za preostale javne Worker rute, HTTPS slike u Adminu, admin read audit.

Ovaj fajl sluzi da **sledeci put** odmah znas sta je uradjeno i sta ostaje, bez kopanja po cetu. Azuriraj ga ukratko posle vecih promena.

**Sta da napises Cursoru na pocetku sledeceg rada:**  
"Prvo procitaj `AGENTS.md` i `docs/STATUS-ZADATAKA.md`, pa nastavi od tamo."

**Brza lokalna provera (bez eksternih testera):**  
`npm run cf:smoke:edge` (proverava health + glavne public Worker rute i vraca status/latenciju/payload size).

**Resilient deploy (kad Cloudflare vrati 500/10500):**  
`npm run cf:deploy:resilient` (retry Worker deploy + Pages deploy sa `functions` workaround-om).

---

## Zaključak (Worker vs hosting vs Firestore)

1. **Dva različita „sajta“.** `rakivinum.com` (i Pages npr. `*.pages.dev`) servira **frontend** (HTML/JS). `https://rakivinum-api.*.workers.dev` je **samo JSON API** (`/health`, `/api/public/...`). Otvaranje Worker korena u pregledaču nikad nije bilo „pokvareno“ — ranije je bilo **404 jer nema stranice**; sada je **`GET /`** jasan JSON odgovor umesto zbunjujućeg „Not Found“.

2. **Zašto grafici nisu isti po URL-u.** Firestore **Reads** u konzoli mere ono što **Firestore stvarno izvrši** (uključujući edge Worker koji zove Firestore). Različit hosting (Pages vs custom domen), **hladan keš**, prvi ulazak vs ponovni, i **broj paralelnih zahteva** daju različite pikove — to **ne znači** da je jedan URL „lošiji“ po dizajnu; znači da je u tom trenutku drugačiji niz read-ova (npr. više miss-eva ili više paralelnih poziva pre fix-a dedupe/in-flight).

3. **Arhitektura koja štedi read-ove.** Javni read ide **Worker-first** (`VITE_EDGE_API_BASE`), pa **ograničen Firebase fallback** gde ima smisla; na Workeru su **cap-ovi**, **edge keš**, **in-flight koalescencija** i ispravan **dedupe** (Promise u mapu *pre* prvog `await`) da se izbegnu dupli puni tokovi. Privatni/admin podaci i dalje **ne** idu na javne GET rute bez auth modela.

4. **Šta je „najbolje“ za korisnika.** Za normalno korišćenje aplikacije uvek **glavni domen** (npr. `rakivinum.com`). Worker URL koristiš za **smoke** (`/health`, `home-bundle`, itd.) ili za debag mreže — ne kao zamenik početne stranice u pregledaču.

5. **Pun URL Workera.** Host mora biti `https://<ime-workera>.<subdomain-naloga>.workers.dev` (npr. `rakivinum-api.ldjs1969.workers.dev`). Adresa oblika `https://rakivinum-api.workers.dev/...` **nije** ispravna za ovaj nalog — pregledač daje *Server Not Found* (DNS), ne aplikacioni 404.

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



