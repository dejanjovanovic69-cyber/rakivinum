# Van Firestore-a: šta to znači i koji su realni putevi

**Stanje danas:** Cloudflare Worker već servira javne GET rute, ali **izvor podataka** i dalje može biti **Firestore REST** (`firestore.googleapis.com`) sa service account-a. Zato „sve na Cloudflare“ **ne uklanja** Firestore read kvotu sama od sebe — samo je **pomeri** sa telefona na edge (i dalje u isti Firebase projekat).

Cilj ovog dokumenta: da možeš **najaviti aplikaciju** i **ne živeti od Spark kvote**, bez iluzije da je „potpuno otkacivanje“ jedan vikend posao.

---

## Nivo 0 — da možeš da pričaš da imaš app (najbrže, dani)

- **Firebase Blaze** (platni plan) + **budžet / alert** u Google Cloud — tipično je to što omogućava **10–50 beta** bez panike oko besplatnog limita.
- **Ne menja arhitekturu**; menja samo da te kvota ne „ubije“ pri prvom marketingu.
- Paralelno: **duži edge keš** na Workeru za javne liste (gde je prihvatljivo zastarevanje), da isti URL retko udara u Firestore.

**Kriterijum uspeha:** možeš mirno da pozoveš ljude da probaju, bez obaveze da sutra migriraš bazu.

---

## Nivo 1 — Firestore kao „izvor istine“, čitanje uglavnom sa Cloudflare-a (nedelje)

Idea: **javni katalog** (destilerije, proizvodi, feed ocena, događaji…) periodično ili na promenu **izveze** u **D1 / KV / R2** (JSON snapshot), a Worker GET **čita samo** taj sloj.

- **Pisanje** (ocene, članstva, admin) i dalje može ići u Firestore kratko, ili u red (Queue) → sinhronizacija.
- Firestore read metrika **pada** jer korisnici ne pale `runQuery` po svakom refreshu — pale ga samo jobovi i pisanja.

**Kriterijum uspeha:** beta + normalan saobraćaj ne držiš na Spark „no-cost“ ograničenju zbog čitanja kataloga.

---

## Nivo 2 — Nova baza istine (meseci)

- **Postgres / D1 / Supabase** + migracija šema + migracija podataka + **Firebase Auth** ili zamena (npr. Clerk, custom JWT).
- Firestore se gasi tek kad su **svi** tokovi (admin, licence, saved, pravila pristupa) presvučeni.

**Kriterijum uspeha:** Firestore projekat može da se ugasi ili ostane samo kao arhiva.

---

## Preporuka za Rakivinum (redosled)

1. **Nivo 0** ako želiš **uskoro** da najaviš app — najmanje inženjeringa, najviše slobode za ljude.
2. **Nivo 1** ako želiš da **Firestore ostane** ali da **čitanje kataloga** ne bude usko grlo ni cena.
3. **Nivo 2** samo ako poslovno odlučite da **ne želite** Firebase kao vendor za podatke.

---

## Šta **ne** rešava samo „još Worker endpointa“

Još endpointa bez **keša / materijalizovanog read modela** i dalje znači: **svaki GET može da završi u Firestore query-ju** — ista klasa problema, samo centralizovano.

---

## Veza sa repoom

- Javni read sloj: `src/lib/dataService.ts` + `workers/index.ts` + `scripts/smoke-edge.ps1`.
- Za implementaciju Nivoa 1 treba eksplicitna lista kolekcija/polja za snapshot i TTL politiku po resursu.

Kad se odluči koji nivo je sledeći, ažurirati **`docs/STATUS-ZADATAKA.md`** (jedan red „Poslednji zapis“ + sledeći korak).
