# App Check — podešavanje korak po korak

Kod je već spreman (`src/lib/appCheck.ts`, pozvan iz `src/lib/firebase.ts`).
Dok `VITE_APPCHECK_RECAPTCHA_SITE_KEY` nije postavljen, App Check je **isključen** i
aplikacija radi kao i do sada. Ovo uputstvo ga uključuje.

> **Ne uključuj enforcement isti dan.** Redosled je: podesi → posmatraj metrike →
> tek onda enforce. Obrnut redosled obara produkciju svima sa starim keširanim bandlom.

---

## Šta App Check rešava, a šta ne

| | Pitanje na koje odgovara |
|---|---|
| `firestore.rules` | „Sme li ovaj korisnik da uradi ovo?“ |
| App Check | „Dolazi li ovaj zahtev uopšte iz moje aplikacije?“ |

Javni Firebase konfig (`apiKey`, `projectId`) je **po dizajnu** vidljiv u bandlu — to nije
propust. Ali bez App Check-a svako može da ga prekopira i gađa Firestore iz skripte,
u granicama pravila, koliko god puta hoće. Pravila ograničavaju **koliko po upitu**;
App Check ograničava **ko uopšte sme da pošalje upit**.

Cloudflare Worker koristi service account i **ne prolazi** ni kroz App Check ni kroz
pravila — javni katalog radi normalno bez obzira na sve ovo.

---

## Korak 1 — napravi reCAPTCHA v3 ključ

1. Otvori <https://www.google.com/recaptcha/admin/create> (bilo koji pregledač)
2. **Label:** `rakivinum-appcheck`
3. **reCAPTCHA type:** izaberi **`Score based (v3)`**
   — *ne* `Challenge (v2)`. Enterprise ne uzimaj: traži naplatu na GCP projektu.
   Google preporučuje Enterprise za nove integracije, ali v3 je i dalje podržan i besplatan.
4. **Domains** — dodaj sve odakle se aplikacija otvara:
   ```
   rakivinum.com
   www.rakivinum.com
   <tvoj-projekat>.pages.dev
   localhost
   ```
   Domen koji zaboraviš ovde daje `permission-denied` tek posle enforcement-a.
5. Prihvati uslove → **Submit**

Dobijaš dva ključa:
- **Site key** (`6L...`) — javan, ide u bandl
- **Secret key** — **nikad** u kod; samo u Firebase konzolu u sledećem koraku

---

## Korak 2 — registruj aplikaciju u Firebase App Check

1. Firebase konzola → **Security** → **App Check** → tab **Apps**
2. Nađi web aplikaciju (`1:699294189587:web:87c2942c298217862417e6`) → **Register**
3. Izaberi **reCAPTCHA v3**
4. Nalepi **secret key** iz koraka 1
5. **Token TTL** ostavi na podrazumevanih 1 h
6. Save

---

## Korak 3 — site key u build

Dodaj u `.env.production` (fajl je u `.gitignore`, ne commit-uje se):

```
VITE_APPCHECK_RECAPTCHA_SITE_KEY="6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Zatim:

```
npm run build
npm run cf:pages:deploy
```

Provera da je ušlo u bandl:

```
grep -ro "6L[A-Za-z0-9_-]\{20,\}" dist/assets/ | head
```

U konzoli pregledača na sajtu mora da piše `[AppCheck] aktivan (reCAPTCHA v3).`
Ako piše upozorenje da site key nije postavljen — `.env.production` nije pokupljen.

**Automatska provera (tri nezavisna dokaza):**

```
DIAG_APPCHECK=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test diag-appcheck --workers=1
```

Proverava: (1) konzolnu poruku, (2) da se reCAPTCHA skripta učitala, (3) da postoji poziv
ka `firebaseappcheck.googleapis.com` — razmena za App Check token. **Treći dokaz je
najvažniji**: bez njega SDK nema token i enforcement bi oborio sajt. Test mora da prođe
PRE nego što uključiš enforcement.

---

## Korak 4 — debug token za lokalni dev

Bez ovoga lokalni `npm run dev` neće proći enforcement.

1. `npm run dev`, otvori aplikaciju, pogledaj konzolu pregledača
2. Firebase SDK ispisuje red oblika:
   ```
   App Check debug token: 1a2b3c4d-... . You will need to add it to your app's App Check settings
   ```
3. Firebase konzola → App Check → Apps → tvoja aplikacija → **⋮** → **Manage debug tokens** → **Add debug token** → nalepi
4. Da ti se token ne menja pri svakom pokretanju, upiši ga u `.env.local`:
   ```
   VITE_APPCHECK_DEBUG_TOKEN="1a2b3c4d-..."
   ```

Isti postupak važi za Playwright/CI ako ikad budu gađali pravi Firestore.

---

## Korak 5 — POSMATRAJ (ne uključuj enforcement još)

Firebase konzola → App Check → tab **APIs** → **Cloud Firestore**.

Tu vidiš podelu zahteva: **verified / unverified / outdated client**.

Čekaj dok **unverified** ne padne blizu nule. Realno **7–14 dana** — toliko treba da svi
korisnici sa keširanim PWA bandlom dobiju novu verziju.

Ako `unverified` uporno stoji visoko, to je signal:
- ili neki tvoj tok nema App Check (proveri da `initAppCheck` nije pomeren posle prvog
  Firestore poziva u `firebase.ts`),
- ili je to baš onaj saobraćaj mimo aplikacije zbog kog sve ovo i radiš.

---

## Korak 6 — enforce

Kad je `unverified` blizu nule: App Check → APIs → **Cloud Firestore** → **Enforce**.

Od tog trenutka svaki Firestore zahtev bez važećeg App Check tokena dobija
`permission-denied`.

**Enable samo za Cloud Firestore.** Ne diraj:
- **Firebase Authentication** — enforcement ume da polomi Google sign-in redirect tok
- **Cloud Functions** — `activateLicense` callable; uključi tek posle Firestore-a, odvojeno

Enforcement se gasi jednim klikom ako nešto pukne.

---

## Provera posle enforcement-a

Ovim redom, jer svaki sledeći zavisi od prethodnog:

1. Početna se učita, dnevna preporuka se vidi
2. `/distilleries` i `/community` — katalog radi *(ovo ide preko Workera, mora da radi i pre App Check-a)*
3. `/label/:id` — ocenjivanje kao **neprijavljen gost**  ← direktan Firestore upis
4. `/activate?token=lic_…` — aktivacija licence  ← direktan Firestore upis
5. Prijava Google nalogom
6. `/admin` — destilerije, proizvodi, licence
7. `/distillery-dashboard` kao vlasnik

Ako 3 ili 4 padnu sa `permission-denied`, prvo isključi enforcement, pa tek onda traži uzrok —
ne ostavljaj produkciju polomljenu dok debug-uješ.

---

## Poznata ograničenja

- **Ad-blockeri** ponekad blokiraju `recaptcha.net` / `google.com/recaptcha`. Takav korisnik
  ostaje bez tokena i posle enforcement-a ne može da koristi direktne Firestore tokove.
  Javni sadržaj mu i dalje radi jer ide preko Workera.
- App Check **nije** zaštita od zloupotrebe od strane legitimnog korisnika aplikacije —
  za to služe pravila i rate limiting.
- Ne zamenjuje popravku iz `docs/FIRESTORE-PIK-NALAZ-2026-08-18.md` (sekcija 5):
  `club_memberships` / `guest_saved_items` i dalje nemaju proverljivog vlasnika.
