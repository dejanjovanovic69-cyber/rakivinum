# NASTAVAK — Firestore pik, deploy popravke (2026-08-18)

Radi SAM, bez pitanja. Sve komande su odobrene unaprijed (`--dangerously-skip-permissions`).
Ako nešto padne, popravi i probaj drugačije — ne stani da pitaš korisnika.

## Gde smo stali (već URAĐENO, ne ponavljaj)

1. **`master` commit `badf26c`** — 54 fajla nekomitovanog rada (hardened `firestore.rules`,
   `PUBLIC_CATALOG_LIMIT`, `x-firestore-reads`, Moja Riznica, Tonight, App Check skela,
   `scripts/health-check.mjs`, `scripts/firestore-rules-check.mjs`, e2e diag specovi).
   Commit je **lokalni** — `master` se NE pushuje.
2. **Worker deploy-ovan**: verzija `ce3b152a-4517-47b2-9f78-915b420814ef`
   na `rakivinum-api.dejanjovanovic69.workers.dev`.
   Mereno: `products` hladan miss = 41 read, `distilleries` = 7, `home-bundle` kv-hit = 0.
3. **Pages deploy-ovan**: `https://8300d2be.rakivinum-6gk.pages.dev`, bandl
   `index-Cw8Vd_UW.js` — isti na `rakivinum.com`. (Ovaj bandl JE bez popravke iz koraka B.)
4. **Provere prošle**: `node scripts/firestore-rules-check.mjs` (0 rupa),
   `node scripts/health-check.mjs` (sve ok), `diag-prod-regress` 3/3.
5. **Ocena kao gost provjerena na produkciji** novim testom
   `e2e/diag-guest-rating.spec.ts` — prošlo, bez `permission-denied`.
   (Ostavila jednu ocenu 4.0 na proizvodu `xMpj0JXh945cy0hZMh3I`.)

## Šta je NEKOMITOVANO u ovom worktree-u (`fix/rating-review-cap`)

- `src/pages/Label.tsx` — `maxLength={2000}` na textarea za recenziju + `slice(0, 2000)`
  u payloadu. **Zašto:** `firestore.rules` (`isValidRatingCreate`) odbija `reviewText`
  duži od 2000 znakova, a UI nije imao limit → gost bi dobio `permission-denied`
  bez objašnjenja.
- `.gitignore` — dodat `repomix-output.txt` (1.5 MB generisan dump).
- `docs/FIRESTORE-PIK-NALAZ-2026-08-18.md` — sekcija 7 ažurirana današnjim rezultatima.
- `e2e/diag-guest-rating.spec.ts` — novi test (pod prekidačem `DIAG_GUEST_RATING=1`).

`node_modules` u worktree-u je junction na `C:\rakivinum\node_modules`.
`.env.production*` su prekopirani u worktree (gitignored, ostaju lokalno).

## ŠTA TREBA DA URADIŠ (po redu)

### A) Provera
```
cd /d C:\rakivinum\.claude\worktrees\review-cap
npm run lint
npm run build
```
`lint` je već prolazio; `build` treba da prođe u ~25 s i napravi `dist/`.

### B) Pages deploy — OBAVEZNO iz kopije van repoa
`npm run cf:pages:deploy` PADA sa `Rename-Item : Access to the path
'C:\rakivinum\functions' is denied` (neki proces drži hendl na folderu).
Zaobilaznica koja radi — Wrangler tada ni ne vidi Firebase `functions/`:

```
powershell -NoProfile -Command "$t='C:\Users\Admin\.claude\jobs\f74ebc00\tmp\pages2'; if (Test-Path $t) { Remove-Item -Recurse -Force $t }; New-Item -ItemType Directory -Force $t | Out-Null; Copy-Item -Recurse -Force 'C:\rakivinum\.claude\worktrees\review-cap\dist' (Join-Path $t 'dist'); Set-Location $t; npx wrangler pages deploy dist --project-name rakivinum --branch master --commit-dirty=true"
```

Zapiši deploy URL koji vrati.

### C) Potvrdi da je javno (deploy protokol iz docs/STATUS-ZADATAKA.md)
- Uporedi hash bandla: `dist/index.html` vs `https://rakivinum.com/` vs novi preview URL.
  Moraju biti isti (`curl -s https://rakivinum.com/ | findstr assets/index-`).
  Novi hash NE sme ostati `index-Cw8Vd_UW.js` — popravka mijenja `Label.tsx`,
  ali `index-*.js` je entry i može ostati isti; provjeri `assets/Label-*.js`.
- `node scripts/health-check.mjs` → mora „SVE U REDU“.
- Regresija na produkciji:
  ```
  set DIAG_PROD_REGRESS=1
  set PLAYWRIGHT_SKIP_WEBSERVER=1
  npx playwright test diag-prod-regress --workers=1 --reporter=list
  ```
  3/3 i „GRESKE: nema“.

**NE pokreći `diag-guest-rating`** ponovo — upisuje pravu ocenu u produkciju.
Već je provjereno.

### D) Commit i push (samo grana, NIKAD master)
```
git add -A
git commit -m "fix(label): cap review text at 2000 chars to match firestore.rules"
git push -u origin fix/rating-review-cap
```
Ako `git push` traži lozinku i nema kredencijala — preskoči push, samo commit,
i to napiši u izvještaju.

### E) Izvještaj korisniku (na srpskom, kratko)
Šta je deploy-ovano, koji URL, rezultati provjera, i **jedina stvar koja ostaje njemu**:

> **App Check** (`docs/APP-CHECK-UPUTSTVO.md`, koraci 1–2) — reCAPTCHA v3 ključ na
> <https://www.google.com/recaptcha/admin/create> i registracija u Firebase konzoli.
> To ide kroz pregledač sa njegovim nalogom i ne može se automatizovati.
> Kad dobije site key: upiši ga u `.env.production` kao
> `VITE_APPCHECK_RECAPTCHA_SITE_KEY=6L...`, pa `npm run build` + Pages deploy iz koraka B,
> i provjeri sa `DIAG_APPCHECK=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test diag-appcheck --workers=1`.
> Enforcement se NE uključuje isti dan (čeka se 7–14 dana da `unverified` padne).

Takođe mu javi da u produkciji stoji test-ocena 4.0 na proizvodu `xMpj0JXh945cy0hZMh3I`
koju može obrisati iz Admin panela.
