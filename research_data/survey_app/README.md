# Atlas Survey App

Local web app for collecting post-race NASA-TLX and trust responses against the
existing `Phase-1`, `Phase-2`, and `Phase-3` race archive.

## What it does

- Scans every `*_race_summary.json` file in the repository.
- Shows pending and completed survey coverage by race.
- Saves one `*_post_race_survey.json` file into the same race folder.
- Exports completed responses as a flat CSV.

## Survey fields

- NASA-TLX Raw
  - `mentalDemand`
  - `physicalDemand`
  - `temporalDemand`
  - `performance` (higher means worse perceived performance)
  - `effort`
  - `frustration`
- Trust in AI race engineer
  - collected only for `llm` races
- Recall confidence
  - 1 to 7
- Optional free-text comment

## Run

```powershell
python survey_app/server.py
```

Then open:

```text
http://127.0.0.1:8765
```

## Scan only

```powershell
python survey_app/server.py --scan-only
```

## Output files

Each saved response is written next to the existing race files:

```text
Phase-2/P2/Race-6/P2_S2_llm_R16_Monza_post_race_survey.json
```
