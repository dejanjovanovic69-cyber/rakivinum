# RAKIJA MASTER - MAINTENANCE RUNBOOK (G2)
Operativni priručnik za održavanje sistema

## Dnevne Aktivnosti
- **Pregled Sigurnosnih Logova**: Otvoriti `/admin-audit` i proveriti da li ima novih "flag-ovanih" ocena.
- **Monitoring Quota**: Provera Firebase Usage-a (Skeniranja i Čitanja).

## Nedeljne Aktivnosti
- **Analiza Trendova**: Pregled najpopularnijih rakija i izveštaj za destilerije partnere.
- **Čišćenje Spam-a**: Trajna blokada korisnika koji su više puta flag-ovani.

## Mesečne Aktivnosti
- **Backup Podataka**: Izvoz `products` i `ratings` kolekcija.
- **Update Radar Profila**: Provera senzorskih prosekova i ažuriranje `Product` entiteta ako ima značajnih odstupanja.

## Hitne Intervencije
- **"Indian Attack" (Spam Napad)**: 
  1. Identifikovati User-Agent u `/admin-audit`.
  2. Blokirati UID.
  3. Po potrebi povećati `cooldown` period u kodu.
- **Server Down**: Provera Cloud Run statusa i Firebase konekcije.

---
*Kontakt za hitne slučajeve: support@rakijamaster.rs*
