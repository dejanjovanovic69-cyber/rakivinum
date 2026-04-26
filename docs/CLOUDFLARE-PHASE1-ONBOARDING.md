CLOUDFLARE FAZA 1 (HOSTING FIRST, BEZ RIZIKA)
=============================================

Cilj:
- Prebaciti frontend deploy na Cloudflare Pages.
- Ne dirati produkcioni Firebase runtime tok dok se hosting ne stabilizuje.

Preuslovi:
- Domen je vec na Cloudflare.
- Aplikacija lokalno prolazi `npm run build`.

1) PRVA PRIPREMA (LOKALNO)
--------------------------

U projektu su pripremljeni:
- `wrangler.toml` (buduci Workers API ulaz)
- `workers/index.ts` (minimalni health endpoint)
- npm skripte:
  - `npm run cf:whoami`
  - `npm run cf:pages:build`
  - `npm run cf:pages:deploy`

Napomena:
- `cf:pages:deploy` koristi Pages deploy preko CLI.
- Ako je Pages project drugo ime, promeniti `--project-name` u `package.json`.

2) CLOUDFLARE PAGES SETUP
-------------------------

Opcija A (preporuceno): Git integracija
- U Cloudflare Dashboard -> Pages -> Create project.
- Povezati Git repo.
- Build command: `npm run build`
- Output dir: `dist`
- Framework preset: Vite (ako je ponudjeno).

Opcija B: CLI deploy
- Prijava: `npm run cf:whoami`
- Build: `npm run cf:pages:build`
- Deploy: `npm run cf:pages:deploy`

3) ENV VARIJABLE (PAGES)
------------------------

Dodati iste javne varijable koje koristi frontend (po okruzenju):
- Firebase config kljucevi koji su potrebni klijentu.
- Ostale `VITE_*` varijable koje app cita.

Bitno:
- Ne unositi server tajne u frontend env.
- Frontend env je vidljiv u browser bundle-u.

4) DNS I DOMEN
--------------

- Povezati produkcioni domen na Pages project.
- Potvrditi da je HTTPS aktivan.
- Testirati `www` i root domen redirekciju po potrebi.

5) POST-DEPLOY SANITY CHECK
---------------------------

Proveriti:
- Home ucitavanje
- Distillery strana
- Label strana
- Scanner flow
- Collection flow
- Bez `permission-denied` regresije

6) ROLLBACK PLAN
----------------

Ako nesto nije u redu:
- Vrati DNS/route na stari hosting.
- Ne dirati backend tokom Faze 1.

7) STA NE RADIMO U FAZI 1
-------------------------

- Ne gasimo Firebase.
- Ne uvodimo D1/R2/KV jos.
- Ne prebacujemo Auth jos.

8) SLEDECA FAZA (FAZA 2)
------------------------

- Uvesti 1-2 read endpoint-a na Workers.
- Frontend cita te endpoint-e za najskuplje liste.
- Merenje read smanjenja pre/posle.

