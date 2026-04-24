# RAKIJA MASTER - TEST PLAN (G1)
Verzija: 1.0
Status: Spremno za festival/kafanu

Ovaj plan je dizajniran za testiranje aplikacije u realnim uslovima (festivali, sajmovi, podrumi).

## 1. Testiranje na Terenu (Kafana/Sajam)
- **Scenario**: Korisnik skenira bocu u mračnoj kafani.
- **Provera**: Da li kamera prepoznaje QR kod pod veštačkim svetlom?
- **Provera**: Brzina učitavanja `Label.tsx` na 3G/4G mreži (Cilj: < 2 sekunde).
- **Provera**: Da li se senzorski radar ispravno prikazuje na malim ekranima?

## 2. Anti-Abuse Testiranje
- **Scenario**: Korisnik pokušava da oceni istu rakiju 5 puta za redom.
- **Očekivano**: Nakon prve ocene, taster "Oceni" postaje neaktivan, a pokušaj ponovnog slanja izbacuje upozorenje "Već ste ocenili danas".
- **Scenario**: Korisnik bez prijave (Gost) pokušava da oceni.
- **Očekivano**: Redirekcija na prijavu ili blokada akcije.

## 3. Destilerski Dashboard
- **Scenario**: Destilerija otvara dashboard na iPad-u/Tabletu.
- **Provera**: Responzivnost Recharts grafikona.
- **Provera**: QR Export - provera da li generisani PNG fajl vodi na ispravan URL proizvoda.

## 4. Radionica (Offline Provera)
- **Scenario**: Tehnolog u podrumu (bez signala) koristi kalkulator razblaživanja.
- **Očekivano**: Kalkulator mora da vrši matematičke operacije bez mrežnog poziva.

## 5. Sigurnosni Audit
- **Scenario**: Admin blokira test korisnika.
- **Očekivano**: Test korisnik odmah dobija "Forbidden" error pri pokušaju nove ocene.

---
**Potpis Tehnologa:** ____________________
**Potpis Admina:** _______________________
