# E2E / smoke testovi (Playwright)

Cilj: **isti scenario svaki put** (`npm run test:e2e`), bez ručnog obilaska telefonom kad menjamo performanse ili Community.

## Prvi put na mašini

```bash
npm install
npx playwright install chromium
```

## Lokalno (podigne Vite sam)

```bash
npm run test:e2e
```

Playwright startuje `npm run dev` na `127.0.0.1:3000` ako server već ne radi.

## Protiv već podignutog URL-a (npr. staging / prod)

```bash
set PLAYWRIGHT_BASE_URL=https://rakivinum.com
set PLAYWRIGHT_SKIP_WEBSERVER=1
npm run test:e2e
```

(PowerShell: `$env:PLAYWRIGHT_BASE_URL="https://..."; $env:PLAYWRIGHT_SKIP_WEBSERVER="1"; npm run test:e2e`)

## UI režim (debug)

```bash
npm run test:e2e:ui
```

## Šta dodavati dalje

U `e2e/smoke.spec.ts` (ili novi fajl) dodaj kratke testove: **jedan assert po ponašanju** (npr. „nema beskonačnog loadera“, „naslov taba vidljiv“). Teške Firebase brojke ne testiramo ovde — za to ostaje `npm run cf:smoke:edge` (dupli GET po ruti gde ima KV keš; kolona `Cache`: `miss` / `kv-hit`) i Firebase konzola.

Trenutno smoke pokriva: početnu, Community (default + tab deep linkovi), `/distilleries`, `/collection` (gost prazan ili „Arhiva“), `/menu` (Gost/Korisnik), `/scan`, `/radionica`, `/my-clubs`, `/activate` (bez tokena — forma), `/label/…` i `/distillery/…` (nepostojeći id — poruka o nedostupnosti).

## Ako test „ne vidi“ naslove

Aplikacija prikazuje **Potvrda starosti** pre sadržaja; smoke uvek prvo potvrđuje 18+ (`beforeEach` u `e2e/smoke.spec.ts`).
