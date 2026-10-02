# Family Health for Home Assistant

A private Home Assistant app for each family member's health story. The first release focuses on children: quick entry for feeding and growth, plus a per-person dashboard. Its data model also supports adult profiles and growth records so future work can add you and your wife, Oura, and other sources without rewriting the child records.

## First-release features

- Create and edit child profiles with name, birth date, optional birth time, relationship, and notes.
- Record breastfeeding with start/end time, calculated duration, optional side, and notes.
- Record expressed breast milk or formula with date/time, volume, and notes.
- Record weight, length, or both at a date/time. Edit and delete entries.
- View a child's 7, 30, 90 day or all-time feeding history. The chart stacks bottle volume by milk type and overlays breastfeeding minutes on the right axis.
- See weight and length against days since birth, and a feeding log sorted newest first with 10, 25, 50, or all entries.
- Enter and view mL or fluid ounces, kg/cm or lb/in. Switching units changes the display and form values, not stored data.

The UI currently creates child profiles. The API and schema support adult profiles and person-owned growth records; adult dashboards, Oura linking, and other health categories are planned as separate future changes. No Oura account connection or data collection is included in this release.

## Install

1. In Home Assistant, open **Settings → Apps → App Store → ⋮ → Repositories** and add `https://github.com/brettparis37-coder/home-assistant-family-health`.
2. Wait for the repository to refresh in the App Store.
3. Install **Family Health**, start it, then open its sidebar panel.
4. Add a child on Home and record a feeding or measurement.

Home Assistant OS or Supervised is required for app support. The interface uses Home Assistant ingress; the app exposes no TCP port.

## Storage and upgrades

All data lives in `/share/home_apps.sqlite3`, the same file as Discogs Connector. This app owns only `family_people`, `family_feedings`, `family_measurements`, its indexes, and the `family_health` row in `app_schema_versions`. It never queries or changes `discogs_` tables. Startup creates missing Family Health tables and writes its schema version. Restarts, updates, and reinstalls reopen the existing database and keep the rows as long as `/share/home_apps.sqlite3` remains present. Do not delete that shared file when reinstalling.

Profiles use stable person IDs. Feedings and measurements reference those IDs. `profile_kind` distinguishes child and adult profiles; feeding entry is restricted to child profiles in this version. Future Oura or other imports can add source-specific tables keyed by person ID and use their own provider record IDs for deduplication. The app does not force unrelated metrics into the feeding or measurement tables.

Canonical stored units are millilitres (`volume_ml`), grams (`weight_g`), and millimetres (`length_mm`). Event times are UTC instants; the browser displays local time. Birth date remains a calendar date. The app uses its own schema version row instead of SQLite's file-wide `user_version`, leaving Discogs migrations independent.

Back up `/share/home_apps.sqlite3` before major updates or moving Home Assistant. A backup of only this app may not contain the shared file under `/share`. SQLite Web can inspect it at `/share/home_apps.sqlite3`.

## Development

Run with Python 3.10+ and `FAMILY_HEALTH_DB` set to a test path. `FAMILY_HEALTH_PORT` overrides the default 8099. The runtime uses only Python's standard library. Run `python -m unittest discover -s tests` from the repository root. Tests cover reopening the file, preserving unrelated Discogs data and schema metadata, per-person isolation, adult profile compatibility, and edits.

