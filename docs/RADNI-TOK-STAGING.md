# Rad bez javnog stresa (nije potrebna „najava“)

Cilj: da **ne moraš** da brineš o najavi, da **ne gasiš/javiš** produkciju na svaki krug, i da razvoj **nije stalno vezan** za isti URL i istu Firestore kvotu kao „živi“ sajt.

## Principi

1. **Produkcija (`rakivinum.com`)** — diraj je kad je paket spreman (deploy), ne kao dnevni eksperiment.
2. **Eksperiment** — uvek na **drugom URL-u** ili za **zatvorenu grupu**.
3. **Najava nije uslov** — aplikacija može da postoji godinama samo za tebe / uži krug; to ne blokira tehnički rad.

---

## Opcija A — Cloudflare Pages **preview** (najmanje frikcije)

- Svaka grana / PR dobija **`*.<project>.pages.dev`** (ili sličan preview URL).
- U preview build podeš **`VITE_EDGE_API_BASE`** na **staging Worker** ili isti Worker sa jasnim dogovorom.
- **Firestore:** idealno **odvojen Firebase projekat** za „sandbox“ (besplatna kvota posebno od prod), ili isti projekat samo ako prihvataš rizik — bolje odvojiti kad krene opterećenje.

**Kad završiš:** merge u `main` + `npm run cf:deploy:resilient` na produkciju — jedan miran korak.

---

## Opcija B — Zaštita javnog origin-a (**Cloudflare Access**)

- Na `rakivinum.com` (ili samo `/`) uključiš **Zero Trust / Access** — ulaze samo nalozi koje ti dodaš (email, OTP).
- Spolja izgleda kao „nije javno“; ti i dalje testiraš **pravi** produkcioni stack kad treba.

Korisno ako želiš **jedan** URL ali bez slučajnih posetilaca.

---

## Opcija C — „Mirujem javno“ bez dramaturgije

- **`robots.txt` disallow** + bez linkova sa društvenih mreža — smanjuje slučajni saobraćaj (nije ista stvar kao Access).
- **PWA / bookmark** — i dalje mogu oni koji znaju URL; za pravu izolaciju koristi A ili B.

---

## Šta raditi u kodu dok traje mir

- **`npm run test:e2e`** i **`npm run cf:smoke:edge`** na preview / lokalno — umesto „10 ljudi na telefonu“.
- **Ne** mešati hitne performans izmene sa „mora odmah na prod“ ako nije nužno — merge u main kad prođe smoke na preview.

---

## Jedna rečenica za tim

**„Javni `rakivinum.com` nije laboratorija; laboratorija je preview / Access / sandbox projekat.“**

Kad se dogovorite koji URL + koji Firebase projekat su „staging“, upiši u **`docs/STATUS-ZADATAKA.md`** (jedan red) da sledeći rad ne počinje od nule.
