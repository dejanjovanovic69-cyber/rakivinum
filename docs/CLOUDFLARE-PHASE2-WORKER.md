Cloudflare Faza 2 - Prvi Worker Read API
=======================================

Sta je uradjeno u kodu:
- Worker endpointi:
  - `/health`
  - `/api/public/distilleries?limit=...`
  - `/api/public/distilleries-by-ids?ids=a,b,c`
  - `/api/public/products?limit=...`
  - `/api/public/community-events?limit=...`
- Frontend `dataService` prvo pokusava Worker API kada postoji `VITE_EDGE_API_BASE`,
  a ako Worker nije dostupan automatski pada nazad na Firebase SDK (fallback).

Zasto je ovo bezbedno:
- Nema "big bang" prekida.
- Ako Worker nije konfigurisan ili padne, aplikacija i dalje radi kao pre.

Koraci za aktivaciju:
1) Postavi Worker secrets:
   - `wrangler secret put FIREBASE_PROJECT_ID`
   - `wrangler secret put FIRESTORE_DATABASE_ID`
   - `wrangler secret put GCP_CLIENT_EMAIL`
   - `wrangler secret put GCP_PRIVATE_KEY`

2) Deploy Worker:
   - `npm run cf:worker:deploy`

3) U Pages projektu dodaj env var:
   - `VITE_EDGE_API_BASE=https://<tvoj-worker-subdomain>.workers.dev`

4) Redeploy Pages.

Brza provera:
- Otvori app i proveri da sve rute rade.
- U network tabu proveri da postoje pozivi ka:
  - `/api/public/distilleries`
  - `/api/public/products`
- Ako Worker ne radi, app i dalje koristi Firebase fallback.

Trenutni status (2026-04-25) - ZAVRSENO:
- Worker je deployovan i `/health` radi.
- Service-account OAuth (JWT) auth je aktivan i validiran.
- `api/public/*` endpointi vracaju podatke.
- `VITE_EDGE_API_BASE` je ukljucen na Pages i produkcioni smoke test je prosao.

Faza 3 status (startovan):
- Prosiren Worker read sloj:
  - `/api/public/distillery/:id`
  - `/api/public/product/:id`
- Dodatni endpointi:
  - `/api/public/ratings-feed`
  - `/api/public/ratings-summary/:productId`
  - `/api/public/product-ratings/:productId`
  - `/api/public/club-actions`
  - `/api/public/club-memberships/:visitorId`
  - `/api/public/license/:token`
  - `/api/public/community-links?limit=...` (pomocni linkovi u meniju)
  - `/api/public/products-by-distillery/:distilleryId?limit=...`
  - `/api/public/club-actions-by-distillery/:distilleryId?limit=...`
  - `/api/public/club-membership-count/:distilleryId` (tacan broj clanova kluba (agregacija))
  - `/api/public/distilleries-by-ids?ids=...` (batch read profila destilerija po ID listi)
  - `/api/public/product-lookup?n=...&r=...` (barkod: `barcodeNormalized` pa `barcode`)
  - `/api/public/scan-clusters/:productId?limit=...` (agregovani top regioni skenova)
- Frontend `Distillery` je prebacen na worker-first read tok (uz Firebase fallback).
- Deploy i verifikacija uradjeni (`rakivinum.pages.dev`).

Napomena za deploy:
- `wrangler pages deploy` trenutno ne podrzava custom `--config` putanju za Pages.
- Zbog toga script koristi `wrangler pages deploy dist --project-name rakivinum`.
- Ako vidis upozorenje o `pages_build_output_dir` iz `wrangler.toml`, to je trenutno ocekivano i ne blokira deploy.

Operativne komande:
- Worker+Pages resilient deploy (retry za Cloudflare 10500/500):
  - `npm run cf:deploy:resilient`
- Brzi smoke svih glavnih ruta:
  - `npm run cf:smoke:edge`




