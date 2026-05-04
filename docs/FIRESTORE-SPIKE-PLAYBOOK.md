# Firestore — šta graf znači i kako da zabeležiš pik (playbook)

Cilj: da **testiranje na `rakivinum.com`** ima jasnu vezu sa onim što vidiš u **Firebase → Firestore → Usage (Reads)**, bez nagađanja.

---

## 1. Šta graf „Reads“ u stvari broji

- U **istom GCP/Firebase projektu** gde živi baza, **svako čitanje dokumenta** koje Firestore uradi se obično vidi kao **Read** (uključujući pozive iz **Cloudflare Workera** preko service account-a).
- Pregledač na `rakivinum.com` **često ne šalje** te read-ove direktno (Worker-first u `dataService`) — zato možeš imati osećaj „klikćem a graf ne reaguje“: **reakcija je na Worker strani**, ne u DevTools kao „Firestore network“.

---

## 2. Zašto je u jednom minutu **0 reads** normalno

- Worker i Cloudflare **keš** (i ponekad KV) mogu da odgovore **bez novog** Firestore čitanja u tom minutnom bucketu.
- Konzola agregira po vremenu — kratka sesija može da padne u bucket gde je **zbir mali** ili **0**.

**0 u jednom minutu ≠ „sajt ne radi“** i **≠** „Firestore je isključen“.

---

## 3. Zašto se pojavi **pik** (očekivano ponašanje)

- **Hladan keš:** prvi zahtev posle TTL-a povlači pun tok (npr. lista + dodatni `get` po dokumentu).
- **`ratings-feed`:** jedan API odgovor može da znači **lista ocena** + **do N `get` po `productId`** + po potrebi **destilerije** (logo) — to su **više read-ova u jednoj rundi**, ali ograničeno brojem utisaka u feed-u.
- **`home-bundle`:** više unutrašnjih kolekcija u jednom odgovoru (članstva ako ima `visitor`, akcije, proizvodi za dnevni izbor, imena destilerija) — opet **jedan** HTTP poziv sa strane klijenta, **više** read-ova na backendu.
- **Paralelno:** više kartica/endpointa odjednom = zbir read-ova u istom minutu.
- **Spolja:** botovi, drugi korisnik, drugi uređaj, skripte (`npm run cf:smoke:edge`, monitor), indeksiranje.
- **Dupli `home-bundle` u istoj sesiji (rešeno u kodu):** ranije su `focus` / `visibility` koristili **drugi** `shouldRunRefresh` ključ od prvog učitavanja, pa je povratak sa etikete na početnu često ponovo palio pun Worker poziv i duplirao read-ove u istom minutu. Sada je **jedan** zajednički ključ u `Home.tsx`.

---

## 4. Kada vidiš pik koji te brine — **šta da zapišeš** (1 minut posla)

1. **Tačno vreme** na grafu (i vremenska zona / da li je letnje računanje).
2. **Scenario u 5 koraka:** npr. početna → preporuka → Zajednica → destilerija X → nazad.
3. **Gost ili ulogovan** (i da li je isti `visitorId` kao juče).
4. **Da li je drugi tab / telefon / PWA** uključen istovremeno.
5. **Screenshot** grafa (kao do sada) + ove četiri tačke u jednoj poruci.

Bez toga je nemoguće pouzdano reći „da li je ovo OK pik ili bug“.

---

## 5. Gruba mapa: šta klijent obično pali na Workera (javni tok)

| Tvoj korak na sajtu | Tipičan Worker poziv (prvi put / keš miss) | Napomena |
|---------------------|-----------------------------------------------|----------|
| Početna (gost) | `GET /api/public/home-bundle` | Više unutrašnjih Firestore upita u jednom handleru |
| Zajednica → utisci | `GET /api/public/ratings-feed?limit=…` | Lista + dodatni read po proizvodu za thumb |
| Spisak destilerija | `GET /api/public/distilleries?limit=…` | Lista dokumenata (limit u URL-u) |
| Spisak proizvoda (globalni, ako se učita) | `GET /api/public/products?limit=…` | Lista do limita |
| Destilerija → katalog | `GET /api/public/products-by-distillery/{id}?…` | Straniceno (manje po stranici) |
| Etiketa | `GET /api/public/product/{id}` ili label-view | Po jedan (ili mali skup) read |

Broj **read-ova po jednom HTTP 200** zavisi od toga koliko dokumenata Worker stvarno pročita u tom handleru — tačan broj je u kodu `workers/index.ts` (REST list / get po id).

### 5.1. Budžet za `home-bundle` (hladan miss na Workera)

Konstante u `workers/index.ts` (`HOME_BUNDLE_*`) — **gornja granica** read-ova po komponenti pre dodatnih `get` za dnevni thumb (0–2):

| Komponenta | Raniji tipični max | Sada (cap) |
|------------|-------------------|------------|
| `club_memberships` (ako ima `visitor`) | 12 | **8** |
| `club_actions` (lista) | 14 | **10** |
| `products` (uzorak za dnevni izbor + usklađeni `daily-recommendations`) | 8 | **6** |
| `distilleries` po `distilleryId` iz akcija (imena) | 6 | **4** |
| + dnevni thumb (logo) | 0–2 | 0–2 |

**Grubi maksimum** (gost sa `visitor`, svi listovi puni): bilo ~**42** read-a po jednom miss-u → sada ~**30** (+ ista margina za dnevni logo). Keš i dalje drži većinu ponovljenih ulazaka van Firestore-a.

### 5.2. Budžet za `ratings-feed` (hladan miss)

Konstante `RATINGS_FEED_*` u `workers/index.ts`:

| Deo | Ranije (grubo) | Sada |
|-----|----------------|------|
| Max `limit` iz query-ja | 30 | **24** |
| Lista `ratings` (fetch cap) | do 30, min 12 | do **24**, min **10** |
| `get` po `productId` (thumb) | do 40 jedinstvenih | do **15** |
| `get` destilerija (logo fallback) | neograničeno u praksi | do **8** |

**Primer** (`limit=20` u URL-u): ~**20** ocena + **15** proizvoda + **8** destilerija = **43** read-a u najgorem slučaju (ranije je gornja granica mogla biti znatno viša pri `limit=30` i 40 proizvoda).

---

## 6. Šta sledeće **inženjerski** (kad imamo zapis iz tačke 4)

- Uporediti **očekivani redosled** poziva sa **Network** tabom u pregledaču (filtar `rakivinum-api` ili tvoj `VITE_EDGE_API_BASE` host).
- Ako broj read-ova **ne uklapa** ni u grubu mapu → onda tražimo **dupli poziv**, **petlju**, ili **fallback na Firestore iz klijenta** (to je pravi bug).

---

## 7. Reference u repou

- `docs/FIRESTORE-READ-AUDIT.md` — šta je već migrirano / cap-ovano.
- `docs/STATUS-ZADATAKA.md` — deploy i istorija odluka.
- `npm run cf:smoke:edge` — brza provera Workera (ne zamenjuje Firestore graf, ali potvrđuje da API živi).

---

## 8. Paket za test (ti samo odradi ovaj tok)

### A) Standardni „smoke“ kroz sajt (uporedi sa Firestore grafom)

1. Zatvori druge tabove sa `rakivinum.com` (da ne mešaju read-ove).
2. **Inkognito** (ili obriši keš sajta + `localStorage` za domen ako želiš „hladno“).
3. Uradi redom: **Početna** → klik na **preporuku dana** (etiketa) → **Destilerije** (spisak) → **Zajednica** (skrol do kraja) → nazad na **Početnu** → zatvori tab.
4. U Firebase konzoli otvori **Firestore → Usage** i nađi minut koji odgovara tom testu; uporedi sa **tačkom 4** iznad ako nešto deluje čudno.

### B) Da vidiš da li Worker odgovara iz keša (bez nagađanja)

**Opcija 1 — DevTools (uvek radi):** F12 → **Network** → filtriraj po hostu API-ja (npr. `workers.dev` / ono što koristi produkcija). Klikni na jedan `GET` ka `/api/public/home-bundle` ili `/api/public/ratings-feed`. U **Response Headers** traži **`x-cache-status`**:

| Vrednost | Značenje (grubo) |
|----------|------------------|
| `miss-store` | Handler je radio posao (Firestore read-ovi su verovatno legli u taj minut); odgovor je keširan za sledeće |
| `mem-hit` | Isti Worker izolat, kratkotrajan memorijski keš |
| `kv-hit` | Keš u Workers KV |
| `cf-hit` | Keš na Cloudflare Cache API (često deliš sa drugim korisnicima istog URL-a) |

**Opcija 2 — brojač u konzoli (posle deploy-a Workera sa `Access-Control-Expose-Headers`):** na `rakivinum.com` u konzoli:

```text
__rakivinumEdgeMeterEnable()
```

Posle reload-a, radi scenario iz tačke A; povremeno u konzoli će se pojaviti `[rakivinum-edge-meter] …` sa `cache:miss-store` / `cache:cf-hit` itd. Ručno: `__rakivinumEdgeMeter()` (tabela), `__rakivinumEdgeMeterReset()` pre novog kruga.

*(Ako `cache:` uvek piše `none`, Worker u produkciji još nema novi CORS expose header — i dalje koristi **Opciju 1** u Network tabu.)*

**Opcija 3 — klijentski Firestore (samo fallback):** `__rakivinumDbReadsEnable()` — broji **samo** ono što pregledač šalje direktno Firestore SDK-u, **ne** Worker read-ove. Korisno ako sumnjaš da neki put i dalje padaš na `getDocs` u klijentu.

### C) Slike „nekad jesu, nekad nisu“

To **nije** isto što i broj read-ova: često znači da za taj proizvod nema validnog **HTTPS** URL-a u podacima posle `sanitizeImageUrl` (npr. samo `data:` u bazi). Rešenje u sadržaju: **Storage / HTTPS** u Adminu za taj proizvod.

---

**Kratko:** graf meri **projekat**, ne samo tvoj laptop; pik často znači **hladni keš + Worker**, ne „nevidljivi haker“. Sa zapisom iz tačke 4 može se ići **ciljano** do uzroka.
