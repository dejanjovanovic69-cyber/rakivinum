# Rakivinum Backup and Recovery

## 1) Daily routine (recommended)

- Start work: run `npm run backup:local`
- Before bigger refactor: run `npm run backup:local`
- End of day: run `npm run backup:local:keep30`
- Once per week: run `npm run backup:full`

Backups are stored in `backups/` as timestamped snapshot folders.

## 2) What is included

- Source code
- Configuration
- Assets

Daily mode includes only critical project parts (`src`, `public`, `scripts`, root config files).

Full mode includes almost everything except:

- `node_modules`
- `dist`
- `.git`
- existing `backups`

## 3) Fast recovery

1. Close dev server.
2. Extract desired `rakivinum_backup_*.zip`.
3. Copy extracted files over project folder.
4. Run `npm install`.
5. Run `npm run dev`.

## 4) Git baseline (must have)

Run once in project root:

```bash
git init
git add .
git commit -m "chore: baseline snapshot before further changes"
```

Then after each stable milestone:

```bash
git add .
git commit -m "chore: stable checkpoint"
```

## 5) Quota-safe behavior now in app

- Shared helper in `src/lib/resilience.ts`:
  - `isQuotaError(err)`
  - `readCache(key)`
  - `writeCache(key, value, ttl)`
- Cached/fallback data added on:
  - `src/pages/Home.tsx`
  - `src/pages/Community.tsx`
  - `src/pages/Distilleries.tsx`

If Firestore daily quota is exhausted, app now tries cached data first and avoids "everything disappeared" feeling.
