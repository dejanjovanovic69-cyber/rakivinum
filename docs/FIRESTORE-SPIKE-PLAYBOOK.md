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

**Kratko:** graf meri **projekat**, ne samo tvoj laptop; pik često znači **hladni keš + Worker**, ne „nevidljivi haker“. Sa zapisom iz tačke 4 može se ići **ciljano** do uzroka.
