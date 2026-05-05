# Uputstva za agenta (Cursor / AI)

## Polazna tačka

1. Prvo pročitaj **`docs/STATUS-ZADATAKA.md`** — tu je trenutno stanje deploy-a, Worker ruta i šta je već urađeno.
2. Za detalje Firestore read migracija vidi **`docs/FIRESTORE-READ-AUDIT.md`**.
3. Na samom početku proveri stanje grane: `git status -sb`.

## PRIORITET #1 (uvek prvo)

- **Ne uvoditi per-visitor cache ključ** za javni `home-bundle` tok. `GET /api/public/home-bundle` mora ostati globalan (bez `?visitor` u pozivu i bez `visitor` u Worker cache ključu).
- **Home članstva se vuku odvojeno** preko `fetchPublicClubMembershipsByVisitorId(...)`; `home-bundle` ostaje samo globalni payload.
- **Cache-first na klijentu ostaje obavezan**: pre mreže proveriti `readCache`, pa tek onda edge/fallback.
- **MyClubs progres obavezno koristi lokalni cache + refresh gate** (`rakivinum_cache_myclubs_progress_<visitorId>_v1`, `myclubs:progress:<visitorId>`).
- Kod svake izmene javnog read toka obavezan redosled: `npm run build` -> `npm run cf:smoke:edge` -> `npm run cf:deploy:resilient`.
- Posle deploy-a obavezno proveriti da je novi bundle stvarno aktivan na `master.rakivinum.pages.dev` (da nema starih `v6` ključeva i `?visitor` u `home-bundle` toku), pa tek onda validirati na `rakivinum.com`.

## Kako da radiš autonomno (bez stalnog „nastavi“)

- U **jednoj** sesiji uradi ceo smisleni paket (kod + provera + commit), umesto da čekaš dodatnu poruku posle svakog koraka.
- Ne pitaj korisnika za potvrdu sitnica; ako postoji više opcija, biraš **najbezbedniju** (Worker-first + Firebase fallback, bez slabljenja pravila pristupa).
- Ako nešto blokira (nema mreže, nema kredencijala), dokumentuj u `STATUS-ZADATAKA.md` šta je ostalo i završi ono što može lokalno.

## Ručno testiranje (da vlasnik ne bude „CI“ posle svake sitnice)

- **Agent prvo automatski:** `npm run lint`, `npm run build`, po pravilu `npm run cf:smoke:edge` kad diraš Worker/edge; `npm run test:e2e` kad menjaš rute / layout / javne stranice (vidi `docs/QA-E2E.md`). Tek u odgovoru jasno napiši šta je mašinski provereno i **šta eventualno** treba ručno (kratko, jednom po smislenom paketu).
- **Ne tražiti** korisnika da posle svake male izmene ponovo prolazi ceo sajt ili Firestore graf; ručno validiranje — **jedan prolaz** kad je paket gotov, po mogućstvu prvo na `master.rakivinum.pages.dev`, pa `rakivinum.com` kad korisnik potvrdi mirno ponašanje.

## Konvencije u ovom repou

- Javni read: **`src/lib/dataService.ts`** — uvek Worker-first (`VITE_EDGE_API_BASE`), zatim `getDoc` / `getDocs` kao fallback gde ima smisla.
- Novi Worker endpoint: **`workers/index.ts`**, zatim helper u `dataService` + po mogućnosti stavka u **`scripts/smoke-edge.ps1`**.
- Privatni / korisnički podaci (saved, lične ocene, admin): **ne** izlagati javnim GET rutama bez auth modela.
- **`shouldRunRefresh`** (`src/lib/refreshGate.ts`): za mount + `focus`/`visibility` istog API paketa koristi **jedan** ključ — ne „initial“ vs „focus“ odvojeno.

## Provera pre commit-a

- `npm run lint`
- `npm run build`
- Ako menjaš **rute / layout / javne stranice**: `npm run test:e2e` (Playwright smoke; prvi put `npx playwright install chromium`). Detalji: `docs/QA-E2E.md`.
- Ako diraš Worker ili edge ponašanje: `npm run cf:smoke:edge` (zahteva `VITE_EDGE_API_BASE` u okruženju skripte ako je tako podešeno).
- Ako je završen veći paket izmena, obavezno osveži `docs/STATUS-ZADATAKA.md` (kratak “Poslednji zapis” + šta je sledeće).

## Deploy

- Produkcija: `npm run cf:deploy:resilient` (samo kada je to cilj zadatka — zahteva Cloudflare nalog i mrežu).
- Ne commit-uj `.firebase/` hosting keš (već je u `.gitignore`).

## Git

- Jedan jasan commit po logičkom celini; poruka na engleskom ili srpskom, uvek smislena rečenica (šta / zašto).
