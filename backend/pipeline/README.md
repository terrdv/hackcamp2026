# VisitWell: data preprocessing pipeline (HackCamp 2026)

VisitWell tells travellers (mainly families in Vancouver visiting relatives abroad) which infectious
diseases matter at their destination for their travel dates, and what to do about them.

**We do not estimate personal infection risk.** We describe disease activity at the destination for the
travel dates, compared with what is normal there, and always show how recent the data is.
Missing data is never turned into "low" or "not present". It is always shown as `unknown`.

```
raw files ──► bronze (unchanged + provenance) ──► silver (clean, long format) ──► gold (outlook)
                                                                                 └► destination_outlook  ◄── the app
```

## Quick start

All commands run from this `pipeline/` folder. The pipeline is self-contained Python and does not depend on
the web app in the repo root.

```bash
cd pipeline
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt     # Windows (use bin/ on macOS/Linux)
.venv/Scripts/python dt_preproc.py                       # all steps, local parquet in data/
.venv/Scripts/python dt_preproc.py --sink databricks     # same + Delta tables in Unity Catalog (uses .env)
.venv/Scripts/python -m pytest                           # unit tests (offline, synthetic data)
.venv/Scripts/python dt_preproc.py outlook VNM 2027-01-25 2027-02-20   # Tet trip, months away -> seasonal
```

| Option | Meaning |
|---|---|
| `--steps bronze silver gold` | run a subset (later steps read the previous layer from `data/<layer>/`) |
| `--offline` | never download; use files already in `data/raw/` |
| `--refresh` | re-download every automatic source |
| `--as-of YYYY-MM-DD` | run date for freshness checks (default: today) |
| `--sink databricks` | also push every table to Databricks |

## Folder layout (`pipeline/`)

```
.gitignore                    pipeline-only ignores (venv, generated data)
config/pipeline.yaml          all destinations, thresholds, excluded years, source URLs, Databricks target
data/seeds/                   hand-curated official-source CSVs (committed)
data/raw/                     downloads + manual files (gitignored); _manifest.json = provenance
data/{bronze,silver,gold}/    local parquet output (gitignored)
data/reports/                 quality_report.csv / quality_report.md
visitwell_pipeline/
  ingest.py                   bronze
  clean/                      silver: influenza, dengue, measles+population+malaria, seeds
  quality.py                  quality report
  gold/                       seasonal, flu_realtime, measles_status, outlook (presence, alerts, destination_outlook)
  api.py                      get_outlook()
  sinks.py                    LocalSink / DatabricksSqlSink (laptop push) / SparkSink (notebook)
  run.py                      orchestrator used by both the CLI and the notebook
databricks/visitwell_pipeline_job.py   Databricks notebook / job entry point
dt_preproc.py                 CLI
tests/                        pytest, synthetic fixtures, no network
```

## Scope

| Disease | Method | Source | Card group |
|---|---|---|---|
| Influenza | real-time if departure ≤ 21 days, otherwise seasonal | WHO FluNet | respiratory |
| COVID-19 | vaccine reminder only (no data pipeline) | config text, linked to PHAC | respiratory |
| Dengue | presence gate, then seasonal | OpenDengue V1.3 + presence seed | mosquito |
| Malaria | static presence (WHO/MAP incidence = supporting evidence only) | presence seed + WHO GHO (+ MAP) | mosquito |
| Yellow fever | static presence + entry requirement | presence seed + YF entry seed | mosquito |
| Measles | recent activity (12-month incidence) + always a vaccine check | WHO provisional monthly data | measles |
| Hepatitis A | static presence | presence seed | food_water |
| Typhoid | static presence | presence seed | food_water |

Destinations: `VNM, PHL, IND, CHN, MEX, BRA` (edit `destinations:` in the config).

## Data sources

| Source | How it is obtained | File in `data/raw/` |
|---|---|---|
| WHO FluNet: [data](https://xmart-api-public.who.int/FLUMART/VIW_FNT?%24format=csv), [dictionary](https://xmart-api-public.who.int/FLUMART/VIW_FLU_METADATA?%24format=csv&%24filter=contains%28DatasetName%2C%20%27FluNet%27%29) | automatic | `flunet/flunet_full.csv`, `flunet/flunet_dictionary.csv` |
| [OpenDengue V1.3](https://github.com/OpenDengue/master-repo/tree/main/data/releases/V1.3): National, Spatial (highest spatial res.) and Temporal (highest temporal res.) extracts | automatic (zip) | `opendengue/*_extract_V1_3.{zip,csv}` |
| [WHO provisional monthly measles data](https://immunizationdata.who.int/global?topic=Provisional-measles-and-rubella-data&location=): "epi curve" xlsx linked from that page | automatic | `measles_who/404-table-web-epi-curve-data.xlsx` |
| Fallback: [TidyTuesday 2025-06-24](https://rfordatascience.github.io/tidytuesday/data/2025/2025-06-24/readme.html) `cases_month.csv` | automatic, used only if the WHO file is unavailable | `measles/cases_month.csv` |
| Population: World Bank WDI `SP.POP.TOTL` (derived from UN World Population Prospects) | automatic (API) | `population/wb_pop.json` |
| Malaria, supporting: WHO GHO `MALARIA_EST_INCIDENCE` (cases per 1,000 at risk) | automatic (API) | `malaria/who_gho_malaria_incidence.json` |
| Malaria, supporting: [Malaria Atlas Project](https://data.malariaatlas.org/) national/admin1 annual incidence | **manual, optional**: export CSV(s) and save as `malaria/map_<anything>.csv`; adjust `sources.malaria_map.columns` if the column names differ | `malaria/map_*.csv` |

If an automatic download fails, the pipeline logs a warning and continues; the dependent diseases come out as
`unknown`. If the WHO measles link changes, download the xlsx by hand from the page above into
`data/raw/measles_who/` (keep the file name or update `sources.measles.file`).

## Seed files (no invented medical facts)

Presence, vaccine recommendations, yellow fever entry rules and alerts come **only** from official sources,
via the CSVs in `data/seeds/`:

| File | Key columns |
|---|---|
| `presence_seed.csv` | disease, location_iso3, admin1, presence ∈ none / some_areas / present / widespread / unknown |
| `yellow_fever_entry_seed.csv` | location_iso3, certificate_required ∈ yes / no / conditional / unknown, condition, min_age_years |
| `vaccine_recommendations_seed.csv` | disease, location_iso3, recommendation, audience |
| `alerts_seed.csv` | disease, location_iso3, admin1, level, title, url, issued, expires (PHAC travel health notices) |

All seed files also have `source_name, source_url, checked_on, verified, needs_review, notes`.

* The rows shipped in `presence_seed.csv` are **drafts** (`verified=false, needs_review=true`) and point to the
  official page where they must be checked. `yellow_fever_entry_seed.csv` and `vaccine_recommendations_seed.csv`
  contain empty rows to fill in. `alerts_seed.csv` is an empty template.
* A row counts only if `verified=true` **and** it has `source_url` and `checked_on`.
* With `seeds.use_unverified: false` (the default), unverified rows are treated as `unknown`.
  Setting it to `true` shows them, flagged `verified=false` with "UNVERIFIED (pending review)" in `notes`.
  Changing the flag only needs `--steps gold`.
* To verify a row: open `source_url`, correct `presence` if needed, then set `verified=true` and `checked_on=YYYY-MM-DD`.
  Re-run `--steps silver gold`.

## Pipeline steps

### 1. Bronze (`ingest.py`)
Downloads or loads every raw file and keeps its values unchanged (as strings). Every row gets `_source`,
`_source_url`, `_file`, `_file_sha256` and `_retrieved_at`. `bronze.ingest_log` has one row per file (status,
sha256, bytes, retrieval method). For Delta, column names are made safe (`Measles total` → `measles_total`).
The two ~500 MB OpenDengue extracts are filtered to the configured destinations; the full zip is archived in
the volume and its hash is recorded.

### 2. Silver (`clean/`): long format, one row per disease × location × period
Every row has `source`, `data_as_of`, `is_complete_year` and `low_sample_flag`.

* **influenza_weekly**: the column mapping (`sources.flunet.columns`) is checked against the FluNet data
  dictionary at runtime. The site-type rows (SENTINEL / NONSENTINEL / NOTDEFINED) are summed per country-week.
  `percent_positive = INF_ALL / SPEC_PROCESSED_NB`. Weeks with fewer than `min_specimens` (20) get
  `low_sample_flag=true` and are excluded downstream.
* **influenza_monthly**: valid weeks pooled by calendar month (the ISO-week Thursday decides the month). A month
  is observed with at least `min_valid_weeks_per_month` valid weeks, and a year is complete when all 12 are observed.
* **dengue_monthly**: national rows come from the Admin0 rows of the National and Temporal extracts. Admin1 rows
  come from Spatial Admin1 rows plus Admin2 summed to Admin1. Weeks are split across months by days. A month is
  observed if at least 80% of its days are covered, and a year is complete with 12 observed months. If several
  sources overlap for a location-year, only the one with the best coverage is kept, so nothing is double counted.
* **measles_monthly**: monthly totals, with unreported months kept as missing (never 0). Then a rolling
  12-month sum, joined to population (same year, else the latest earlier year; `pop_year` and `pop_source` are
  kept), gives `incidence_12m_per_million`. Any gap in the window makes it null, which becomes `unknown`.
* **malaria_annual**: annual incidence by country (and admin1 if MAP is present), with `is_latest`.
* **population**, **seed_\***: validated seeds.

### 3. Quality report
`data/reports/quality_report.csv` and `.md`, also written to `silver.quality_report`. Per disease × country it
gives the first and last period, % missing months, complete years and data as of.

### 4–9. Gold
* **seasonal_profile** (influenza, dengue): for each complete year, `index = month value / that year's monthly
  mean`, then the median across years. Fewer than 5 years gives `insufficient_data`; no data at all gives
  `unknown`. Influenza excludes 2020–2021 (`influenza.excluded_baseline_years`). The labels are peak (≥ 1.5),
  moderate (1.0–1.5) and low (< 1.0). Consistency is the share of years in which the month was in that year's
  top 3; a score ≥ 0.6 is `consistent`, else `variable`. Tied months do not count as top 3.
* **flu_realtime**: the latest valid week is compared with the same ISO week in earlier, non-excluded years
  (p50/p75/p90; at least 5 years needed; week 53 is compared with week 52). The labels are typical (< p75),
  higher_than_usual (p75–p90) and much_higher (> p90). If the data is older than 4 weeks or there are too few
  baseline years, `use_seasonal_fallback=true` and `fallback_reason` is recorded.
* **measles_status**: not_reported (0 cases in 12 months), circulating, or high (≥ `high_incidence_per_million`,
  a **placeholder of 10 that needs review**). Data older than `max_age_months` (6) becomes `unknown`, with the last
  status kept in `notes`. An active official alert overrides the status to `outbreak`.
* **presence**: from the presence seed. Malaria rows carry the WHO/MAP incidence as `supporting_*` only.
* **alerts**: usable seed alerts active on the run date.
* **destination_outlook**: the only table the app reads.

| column | meaning |
|---|---|
| location_iso3, admin1, admin1_key | admin1 is null for national rows |
| disease, card_group | respiratory / mosquito / measles / food_water |
| row_type | seasonal / realtime / presence / recent_activity / reminder |
| month | 1–12 for month-resolved rows; null means it applies to any month |
| level | peak/moderate/low · typical/higher_than_usual/much_higher · not_reported/circulating/high/outbreak · none/some_areas/present/widespread · unknown · null for reminders |
| based_on | realtime / seasonal / recent_activity / static_presence / official_alert / unknown / vaccine_reminder |
| consistency, consistency_score, seasonal_index | seasonal rows only |
| data_as_of, source, source_url, verified, notes | provenance shown to users |
| details | JSON with method specifics (percentiles, fallback reason, incidence, YF entry rule, …) |

Presence gate: `none` produces no row, and `unknown` produces a single row with level `unknown`. A dengue
location that is present but has too little seasonal data shows the presence level (`based_on=static_presence`).

### 10. `get_outlook(location_iso3, start_date, end_date, today, admin1=None)`
```python
from visitwell_pipeline.api import get_outlook
get_outlook("BRA", date(2027, 3, 1), date(2027, 3, 20), today=date(2026, 11, 7), admin1="São Paulo")
```
* Covers every month in the trip window (across year ends). A card's level is the highest seasonal level in the
  window, with the per-month breakdown in `months`.
* Influenza: real-time if `start_date − today ≤ 21` days, re-checking freshness against `today`; otherwise, or
  on fallback, seasonal (`method_reason`, `fallback_reason`).
* Admin1 rows are used when they exist for that disease, otherwise national rows.
* Always adds the COVID-19 reminder (respiratory, no level) and the measles vaccine check.
* Returns `{"groups": {"respiratory": [...], "mosquito": [...], "measles": [...], "food_water": [...]}, ...}`.

## Databricks

Tables are created automatically in Unity Catalog:

| schema | tables |
|---|---|
| `visitwell.bronze` | ingest_log, flunet_raw, flunet_dictionary, opendengue_{national,spatial,temporal}_raw, measles_raw, population_raw, malaria_who_raw (+ malaria_map_raw) |
| `visitwell.silver` | influenza_weekly, influenza_monthly, dengue_monthly, measles_monthly, malaria_annual, population, seed_presence, seed_yellow_fever_entry, seed_vaccines, seed_alerts, quality_report |
| `visitwell.gold` | seasonal_profile, flu_realtime, measles_status, presence, alerts, **destination_outlook** |

Volume `/Volumes/visitwell/bronze/landing/` holds `raw/` (archived source files + `_manifest.json`) and `_staging/` (parquet used to load the tables).

**From a laptop:** put the credentials in the repo-root `.env` (gitignored, shared with the app; see
`.env.example`) or in `pipeline/.env`, which wins if both exist. Then run `python dt_preproc.py --sink databricks`.
```
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_TOKEN=<personal access token>
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<id>
```
Each table is staged as parquet in the volume, then `CREATE OR REPLACE TABLE … AS SELECT * FROM read_files(...)`
runs on the SQL warehouse. Catalog, schemas and volume are created if missing (`databricks:` in the config).

**Inside Databricks:** open `databricks/visitwell_pipeline_job.py` from a Git folder or workspace folder that
contains the repo, and run it, or add it as a Job task with parameters `steps`, `offline` and `as_of`. It reads
raw files from the volume, calls the same `run_all()`, and writes with `saveAsTable`.

## Tests
`python -m pytest`: seasonal index and labels, insufficient years, excluded years, consistency, percentile
labels and boundaries, freshness fallback (at build time and at query time), presence gate (none and unknown),
the 21-day switch boundary, measles thresholds, staleness and alert override, the missing-data → unknown rule
(influenza, measles, seeds), week-to-month splitting, the FluNet dictionary check, and Delta-safe columns.
The tests do no network or file I/O beyond pytest's tmp dir.

## Known limitations / to review
* Every presence seed row is a draft until someone verifies it against the linked official page.
* The measles `high_incidence_per_million` threshold is a placeholder.
* Measles data for Vietnam in the WHO file currently ends 2025-02, so it shows as `unknown` (stale).
* India has no sub-annual national dengue data in OpenDengue V1.3, so its dengue card shows presence only.
* Admin1 dengue profiles mostly cover older years (e.g. VNM/PHL up to 2010); `data_as_of` shows this.
* MAP admin1 malaria is not included until a manual export is added.
