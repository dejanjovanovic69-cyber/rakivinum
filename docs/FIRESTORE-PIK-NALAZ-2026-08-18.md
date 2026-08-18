# Firestore pik — nalaz i plan (2026-08-18)

Analiza uzroka velike Firestore potrošnje „po jednom ulasku“. Merenja su rađena nad
živim Workerom i živom bazom; brojevi u tabelama su izmereni, ne procenjeni.

---

## 1. Šta je izmereno

| Endpoint | Stavki | Payload | Od toga base64 |
|---|---|---|---|
| `/api/public/products` | 41 | 454 KB | 442 KB (97%) |
| `/api/public/distilleries` | 7 | 99 KB | 98 KB (99%) |
| `/api/public/ratings-feed` | 12 | 262 KB | 259 KB (99%) |
| `/api/public/home-bundle` | — | 14 KB | 14 KB (98%) |

**Baza je mala** — 41 javni proizvod, 7 destilerija. Jedan hladan miss fizički ne može
da napravi hiljade read-ova iz ovih kolekcija.

### Provereno i ISKLJUČENO kao uzrok

- **Worker keš radi.** Posle 11 minuta (isteka memorijskog TTL-a od 10 min) oba kataloga
  vraćaju `x-cache-status: kv-hit`. KV sloj je zdrav.
- **Klijent ne čita Firestore direktno.** `DISABLE_DIRECT_FIRESTORE_READS = true`,
  nema nijednog `onSnapshot` u `src/`, presence tracking je ugašen.
- **Stari Worker NE prima saobraćaj iz aplikacije.** `edgeApiBase.ts:11` eksplicitno
  odbija `ldjs1969` adresu i vraća ispravnu, pa `.env.production.local` nije imao efekta.

---

## 1b. Merenje „2000 read-ova za jedan ulazak“ (dopuna)

### Veličine kolekcija (`getCountFromServer`, praktično besplatno)

| Kolekcija | Dokumenata |
|---|---|
| products | **41** |
| distilleries | **7** |
| ratings | **52** |
| licenses | **16** |
| club_memberships | **13** |
| guest_saved_items | **1** |
| club_actions | **0** |
| **ukupno** | **130** |
| scans | *nije merljivo anonimno (pravila brane `list`)* |

### Šta jedan ulazak stvarno pošalje (mereno na `rakivinum.com`)

| Scenario | Edge (Worker) | Firestore direktno iz pregledača |
|---|---|---|
| Samo početna | **1** × `/api/public/home-bundle` | 0 |
| Direktno na etiketu | **1** × `/api/public/label-view/{id}` | **6** (3× `Listen/channel`, 3× `Write/channel`) |
| Početna → Zajednica → Destilerije | **1** × `/api/public/distilleries` | 0 |

Tih 3 `Write/channel` je `logProductScan` — svaki otvoren `/label/:id` upisuje dokument
u `scans` (`source: "label_open"`).

### Gornje granice Worker handlera na hladnom miss-u

| Handler | Max dokumenata |
|---|---|
| `label-view` | 1 proizvod + 1 destilerija + ≤8 ocena ≈ **10** |
| `home-bundle` | ≤3 akcije + ≤2 proizvoda + ≤4 destilerije + ≤2 logo ≈ **11** |
| `products` / `distilleries` | ograničeno veličinom kolekcije (**41** / **7**) |
| `scan-clusters`, `product-ratings` | ≤80 |

### Zaključak merenja

**2000 read-ova ne može da dođe iz aplikacije.** Nema kolekcije te veličine osim
eventualno `scans`, a nijedan handler ne čita `scans` bez `limit`-a (max 80).
Da bi aplikacija napravila 2000, morala bi da uradi ~15 punih prolaza kroz sve
kolekcije u istom minutu — a mereno je 1 mrežni poziv po stranici.

### Kako pripisati pik (uradi ovim redom)

Nova dijagnostika: Worker sada vraća zaglavlje **`x-firestore-reads`** sa tačnim brojem
pročitanih dokumenata po zahtevu (0 na keš pogotku), i loguje `[fsread] path docs=N`.

1. **Zatvori Firebase konzolu.** Tab „Firestore → Data“ **sam generiše read-ove** —
   pregledanje kolekcija čita dokumente i drži žive listenere. Ovo je najčešći uzrok
   „pika koji ne mogu da objasnim“. Ne meri sa otvorenom konzolom.
2. Otvori sajt u **Incognito**, uradi tačno jedan scenario, zapiši minut.
3. `npx wrangler tail` u drugom prozoru — vidiš `[fsread]` redove uživo.
4. Uporedi zbir iz `[fsread]` sa Firebase → Usage za taj minut:
   - **približno isto** → potrošnja je iz aplikacije, gledaj koji handler dominira
   - **konzola mnogo veća** → read-ovi dolaze mimo Workera: Firebase konzola, Admin panel,
     ili neko gađa bazu direktno (zbog čega su pravila i App Check prioritet)

Ponovljivo merenje klijentske strane:

```
DIAG_READ_TRACE=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test diag-read-trace --workers=1
```

> **Zamka pri merenju:** age gate zaključava celu aplikaciju (`App.tsx`: `if (!ageOk)`).
> Ako se ne sačeka da se dugme pojavi pa tek onda klikne, ništa se ne učita i merenje
> lažno pokaže **nula** zahteva. Prva tri pokušaja merenja su baš zbog toga bila pogrešna.
> Dodatno, `Home` pušta mrežni refresh tek na interakciji ili posle 10 s.

---

## 2. Glavni nalaz: baza je bila otvorena za ceo internet

Test bez ikakve prijave, sa javnim Firebase konfigom iz bandla:

```
products             READABLE (anon)
distilleries         READABLE (anon)
ratings              READABLE (anon)
licenses             READABLE (anon)
club_memberships     READABLE (anon)
guest_saved_items    READABLE (anon)
```

Bez `limit()` u pravilima, jedan `getDocs(collection(db,'ratings'))` čita **celu kolekciju**,
koliko god puta neko hoće. To zaobilazi Worker, ne vidi se u Cloudflare logovima, i jedino
to može da napravi pik koji se ne poklapa sa tvojim klikovima. **App Check ne postoji.**

Konkretne rupe u starim pravilima:

| Pravilo | Posledica |
|---|---|
| `licenses: allow read: if true` | Svako izlista sve licence i tokene → besplatan premium |
| `licenses: allow update: if rakivinumLicenseActivationAllowed()` (funkcija je `return true`) | Svako prepiše bilo koju licencu — plan, rok, status |
| `products update: writeFields.hasOnly([...])` bez `isSignedIn()` i bez provere vrednosti | Svako upiše `averageRating=5, ratingCount=999999` bilo kom proizvodu |
| `ratings / scans: allow create: if true` | Neograničen upis, nula validacije |
| `club_memberships / guest_saved_items: allow delete: if true` | Svako briše tuđe podatke |
| `community_events`, `community_links`, `eventProposals`, ne postoje u pravilima | Padale na wildcard deny → Admin panel ih nikad nije učitao |

---

## 3. Sporedni nalaz: fragmentacija keša

Worker pravi ključ keša po `limit` parametru (`servePublicCached`). Stranice su tražile
različite limite za **iste podatke**:

| Mesto | Bilo |
|---|---|
| `Community.tsx` | `products=200/350`, `distilleries=250/350` |
| `Distilleries.tsx` | `distilleries=350` |
| `TonightRecommendations.tsx` | `products=60/120` |
| `Menu.tsx` | `community_links=10/80` |
| `dataService` default | `products=120`, `distilleries=100` |

Pet ključeva za 41 proizvod. Jedan korisnik kroz Početna → Zajednica → Destilerije → Tonight
izazove 4 puna skena umesto jednog, i to u sva tri sloja keša.

Uz to je `maxScan` bio do **4000** (`limitCount * 30`, cap 4000) — gornja granica naplativih
read-ova po jednom hladnom miss-u, da bi se vratilo 41 red.

---

## 4. Šta je urađeno

### firestore.rules (v2-hardened) — NIJE DEPLOY-OVANO

- `licenses`: `get` ostaje otvoren (token JESTE ID dokumenta, nije pogodljiv),
  ali `list` je sada samo admin → **nema više enumeracije tokena**.
- `licenses` update: samo polja koja `Activate.tsx` stvarno šalje, `maxDevices` se ne sme
  podići, `expiresAt`/`status`/`plan` se uopšte ne mogu dirati.
- `products` update: anonimno ocenjivanje i dalje radi, ali `ratingCount` mora da bude
  tačno `+1`, a `averageRating` u opsegu 0–5.
- `ratings`/`scans` create: validacija tipa, opsega, dužine i `createdAt == request.time`;
  `userId` se ne može podmetnuti tuđi.
- Novi `listCappedAt()` na svim `list` pravilima → **nijedan upit ne može da povuče
  celu kolekciju**. Worker koristi service account i ne prolazi kroz pravila, pa nije dotaknut.
- `community_events` / `community_links` / `eventProposals` / `rating_logs` → admin-only
  (popravlja Admin panel, bez nove javne površine).
- `online_presence` upis zatvoren dok je funkcija ugašena u klijentu.

### Keš i Worker

- Nova konstanta `PUBLIC_CATALOG_LIMIT` u `cachePolicy.ts`; sve stranice traže isti limit
  → 5 ključeva keša postaje 2.
- `WORKER_CATALOG_MAX_SCAN` 4000 → **600**, množilac 20×/30× → **3×**.
- `mask.fieldPaths` na katalog `listDocuments` pozivima — ne smanjuje broj read-ova
  (naplaćuje se po dokumentu), ali drastično smanjuje bajtove koje Firestore šalje Workeru.
- `PUBLIC_CATALOG_CACHE_BUSTER` 6 → 7 (semantika liste se promenila).
- `dataService`: dodat `limit()` na dva `documentId() in chunk` upita — bili su bez limita
  i pali bi pod novim cap-om ako se fallback ikad vrati.

---

## 5. Šta OSTAJE otvoreno (svesno)

`club_memberships` i `guest_saved_items` i dalje imaju `allow delete: if true`.
`visitorId` je nasumičan string iz `localStorage`, bez ikakve autentifikacije — pravila
**ne mogu** da provere da pozivalac zaista poseduje taj visitorId. Ograničena je šteta
(cap na `list`, validacija upisa), ali rupa se ne može zatvoriti pravilima.

Prava popravka je jedna od:
1. Prebaciti ta dva toka na Worker (service account, kao riznica), ili
2. Uvesti **Firebase Anonymous Auth** pa vezati `visitorId` za `request.auth.uid`.

Preporuka: opcija 2 — jeftinija je i rešava i `ratings`/`scans` validaciju usput.

---

## 6. ⚠️ ZAMKA: `firebase deploy --only firestore:rules` NE RADI NIŠTA

U ovom projektu `firebase.json` ima `"firestore"` kao **niz od dve baze**. Sa takvim
konfigom CLI prećuti pravila:

```
$ npx firebase deploy --only firestore:rules
i  firestore: ensuring required API firestore.googleapis.com is enabled...
+  Deploy complete!          <-- a pravila NISU objavljena
```

U `--debug` izlazu se vidi da CLI traži samo `datastore.indexes.*` dozvole — tretira to
kao deploy indeksa. Nema reda „checking firestore.rules for compilation errors“.

**Ispravna komanda cilja konkretnu bazu:**

```
npx firebase deploy --only "firestore:ai-studio-e4c0de88-b3b9-42ae-b6be-4bdfddca62ef:rules" \
  --project gen-lang-client-0889534325
```

Ispravan izlaz **mora** da sadrži:

```
+  cloud.firestore: rules file firestore.rules compiled successfully
+  firestore: released rules firestore.rules to cloud.firestore
```

Ako ta dva reda ne vidiš — **ništa nije objavljeno**, bez obzira na „Deploy complete“.
Isto važi i za `--dry-run`: proverio sam ga namerno polomljenim fajlom i **propustio ga je**,
tako da `--dry-run` NIJE validacija pravila.

Posle svakog deploy-a pravila pokreni proveru:

```
node scripts/firestore-rules-check.mjs
```

---

## 7. Redosled primene

1. ✅ **Pravila — URAĐENO 2026-08-18.** Objavljena gornjom komandom, kompajler ih je
   prihvatio, i provereno:
   - dump cele kolekcije: blokiran za svih 8 kolekcija
   - `licenses` lista: blokirana anonimno (ranije potpuno otvorena)
   - upiti koje aplikacija koristi (`limit`): i dalje rade
   - 6 napada (lažne ocene, podmetnut datum, tuđi `userId`, izmena naziva proizvoda):
     svi odbijeni
   - regresija na `rakivinum.com`: početna, etiketa, zajednica, destilerije — rade,
     bez ijedne `permission-denied` greške
2. ✅ **Upisni tokovi — PROVERENO 2026-08-18** (bilo je „uradi ručno jednom“):
   - **ocenjivanje kao gost** na `/label/:id` — **radi na produkciji.** Novi test
     `e2e/diag-guest-rating.spec.ts` prolazi ceo pravi tok (age gate → „Oceni proizvod“ →
     „Snimi ocenu“) i dobija modal „Ocena je uspešno sačuvana“, bez ijednog
     `permission-denied`. Time su potvrđena oba najrizičnija pravila:
     `isValidRatingCreate` **i** `isRatingAggregateBump` (transakcija u `Label.tsx`
     menja tačno `averageRating` + `ratingCount`).

     > Test **stvarno upisuje** u produkciju, pa je pod prekidačem `DIAG_GUEST_RATING=1`
     > i ne ide u redovni run. Prvim pokretanjem je na proizvodu
     > `xMpj0JXh945cy0hZMh3I` ostala jedna ocena **4.0** („Gost“, bez recenzije).
     > Obriši je iz Admin panela ako ti smeta u agregatu.

   - **upis u `scans`** — potvrđen usput, `diag-prod-regress` test etikete
     (`source: "label_open"`, `timestamp == request.time`).
   - **aktivacija licence** `/activate?token=lic_…` — **nije izvršena** (nema tokena za
     jednokratnu upotrebu, a prava licenca bi potrošila slot uređaja). Provereno statički,
     polje po polje: `Activate.tsx` `writeViaClient()` šalje tačno
     `token, clientName, [type], maxDevices, isUsed, activatedDevices, lastActivatedBy, usedAt`
     — sve je u `hasOnly` listi, `maxDevices` se prepisuje istom vrednošću, `isUsed` je
     uvek `true` (uređaj se dodaje pre upisa), `usedAt` je `serverTimestamp()`.
     Klijent već sam odbija aktivaciju kad se dostigne `maxDevices`, pa `size() <=`
     provera ne može da padne pre njega. Primarni put je ionako callable
     `activateLicense` (admin SDK, ne prolazi kroz pravila) — klijentski upis je fallback.
   - **Admin panel** i **Distillery dashboard** — traže prijavu, nisu proveravani.

   Ako neko od njih ipak vrati `permission-denied`, prvi osumnjičeni su tri provere
   `== request.time`; izbaci baš njih, pa tek onda gledaj dalje.

   **Popravljeno usput:** `reviewText` u pravilima ima cap od 2000 znakova, a `textarea`
   u `Label.tsx` nije imao `maxLength` — gost sa dužom recenzijom bi dobio
   `permission-denied` bez ikakvog objašnjenja. Dodat `maxLength={2000}` i `slice(0, 2000)`
   pre upisa. Ostala ograničenja dužine/oblika iz pravila su proverena protiv klijenta:
   `PUBLIC_CATALOG_LIMIT` je 200 (cap 400), riznica ide isključivo preko Workera
   (service account, bez pravila), `scans` fallback sa `limit(300)` je iza
   `DISABLE_DIRECT_FIRESTORE_READS` i traži admina/vlasnika. Nema drugih neusklađenosti.
3. ⏳ **App Check — OSTAJE, traži tvoje ruke.** `docs/APP-CHECK-UPUTSTVO.md`, koraci 1–2
   (reCAPTCHA v3 ključ + registracija u Firebase konzoli) idu kroz pregledač sa tvojim
   nalogom i ne mogu se automatizovati. Kod je spreman i neaktivan dok
   `VITE_APPCHECK_RECAPTCHA_SITE_KEY` ne uđe u `.env.production`. Bez njega svako i dalje
   može da gađa bazu direktno, samo sada u manjim porcijama.
   `scripts/health-check.mjs` svakog dana proverava da li je postao aktivan.
4. ✅ **Deploy Workera i frontenda — URAĐENO 2026-08-18.**

   Worker: verzija `ce3b152a-4517-47b2-9f78-915b420814ef` na
   `rakivinum-api.dejanjovanovic69.workers.dev`.
   Pages: `https://8300d2be.rakivinum-6gk.pages.dev`, bandl `index-Cw8Vd_UW.js`
   je identičan lokalnom `dist/` i onome što servira `rakivinum.com`.

   `x-firestore-reads` sada radi i atribucija je tačna:

   | Endpoint | `x-cache-status` | `x-firestore-reads` |
   |---|---|---|
   | `/api/public/home-bundle` | `kv-hit` | **0** |
   | `/api/public/products` | `miss-store` | **41** |
   | `/api/public/distilleries` | `miss-store` | **7** |

   Hladan miss celog kataloga je **48 read-ova**, keš pogodak **0** — što merenjem
   zatvara priču: pik od 2000 read-ova ne dolazi iz aplikacije.

   > **Zamka pri Pages deploy-u:** `npm run cf:pages:deploy` je pao sa
   > `Rename-Item : Access to the path 'C:\rakivinum\functions' is denied` — neki proces
   > je držao hendl na folderu. Rešenje bez čekanja: prekopiraj `dist/` van repoa i
   > pokreni `npx wrangler pages deploy dist --project-name rakivinum --branch master
   > --commit-dirty=true` iz tog foldera. Wrangler tada ni ne vidi Firebase `functions/`,
   > pa preimenovanje uopšte nije potrebno.
5. ✅ **Stari Worker obrisan — URAĐENO 2026-08-18.**

   Pre brisanja izmereno: bio je **živ i čitao Firestore** (`x-cache-status: miss-store`),
   sa istim service account kredencijalima, ali **bez** `x-firestore-reads` — dakle
   nevidljiv potrošač. Vraćao je samo 5 stavki po listi (kod iz maja).

   `wrangler tail` je slušao 55 s → **nula zahteva**. Tail je zatim potvrđen sopstvenim
   zahtevom (pojavio se u logu), pa „nula“ nije značila pokvaren instrument.

   Posle brisanja: stari URL vraća **404**, produkcijski Worker i `rakivinum.com` rade.

   > **Napomena:** na `ldjs1969` nalogu ostaje i Pages projekat `rakivinum`
   > (`rakivinum.pages.dev`, bandl iz maja). Ne troši Firestore, ali se **isto zove** kao
   > produkcijski projekat na drugom nalogu — što je već jednom umalo dovelo do deploy-a
   > na pogrešno mesto. Razmisli da ga obrišeš ili preimenuješ.

---

## 8. Praćenje

**Dnevna provera, lokalno.** Windows Task Scheduler zadatak `Rakivinum health check`
pokreće `scripts\health-check.cmd` svakog dana u **08:00**.

- Log: `backups\health-check.log`
- Ako provera padne, nastaje `PROVERA-PALA.txt` u korenu projekta (obriši ga kad rešiš problem)
- Ručno: `node scripts/health-check.mjs` ili `scripts\health-check.cmd`

Proverava: da pravila nisu vraćena na staro, da Worker i dalje vraća `x-firestore-reads`,
da aplikacijski upiti rade, i da li je App Check postao aktivan.

**Zašto ne cloud rutina:** probana je (`trig_01NdGMUV8tdMJcqei485EdWJ`) i **ne radi** —
mrežna polisa scheduled okruženja blokira izlazni saobraćaj ka `rakivinum.com` i
`*.workers.dev` (proxy vraća `403 connect_rejected`). Rutina je zato pauzirana.
Ako ikad zatreba, prvo se ti domeni moraju dodati na allowlist okruženja.

### Rollback pravila

```
git checkout HEAD -- firestore.rules
npx firebase deploy --only "firestore:ai-studio-e4c0de88-b3b9-42ae-b6be-4bdfddca62ef:rules" --project gen-lang-client-0889534325
```

### Ako nešto pukne posle koraka 1

Najverovatniji krivac je `createdAt == request.time` / `timestamp == request.time` /
`usedAt == request.time`. Te tri provere zahtevaju da klijent koristi `serverTimestamp()`
(trenutno koristi). Ako aktivacija ili ocenjivanje počnu da vraćaju `permission-denied`,
prvo izbaci baš te tri linije, pa tek onda gledaj dalje.
