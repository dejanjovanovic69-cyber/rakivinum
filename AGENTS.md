# Uputstva za agenta (Cursor / AI)

## Polazna tačka

1. Prvo pročitaj **`docs/STATUS-ZADATAKA.md`** — tu je trenutno stanje deploy-a, Worker ruta i šta je već urađeno.
2. Za detalje Firestore read migracija vidi **`docs/FIRESTORE-READ-AUDIT.md`**.

## Kako da radiš autonomno (bez stalnog „nastavi“)

- U **jednoj** sesiji uradi ceo smisleni paket (kod + provera + commit), umesto da čekaš dodatnu poruku posle svakog koraka.
- Ne pitaj korisnika za potvrdu sitnica; ako postoji više opcija, biraš **najbezbedniju** (Worker-first + Firebase fallback, bez slabljenja pravila pristupa).
- Ako nešto blokira (nema mreže, nema kredencijala), dokumentuj u `STATUS-ZADATAKA.md` šta je ostalo i završi ono što može lokalno.

## Konvencije u ovom repou

- Javni read: **`src/lib/dataService.ts`** — uvek Worker-first (`VITE_EDGE_API_BASE`), zatim `getDoc` / `getDocs` kao fallback gde ima smisla.
- Novi Worker endpoint: **`workers/index.ts`**, zatim helper u `dataService` + po mogućnosti stavka u **`scripts/smoke-edge.ps1`**.
- Privatni / korisnički podaci (saved, lične ocene, admin): **ne** izlagati javnim GET rutama bez auth modela.

## Provera pre commit-a

- `npm run lint`
- `npm run build`
- Ako diraš Worker ili edge ponašanje: `npm run cf:smoke:edge` (zahteva `VITE_EDGE_API_BASE` u okruženju skripte ako je tako podešeno).

## Deploy

- Produkcija: `npm run cf:deploy:resilient` (samo kada je to cilj zadatka — zahteva Cloudflare nalog i mrežu).
- Ne commit-uj `.firebase/` hosting keš (već je u `.gitignore`).

## Git

- Jedan jasan commit po logičkom celini; poruka na engleskom ili srpskom, uvek smislena rečenica (šta / zašto).
