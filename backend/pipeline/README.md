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
data/seeds/                   map coordinates (reference only, committed)
data/raw/                     downloads + manual files (gitignored); _manifest.json = provenance
data/{bronze,silver,gold}/    local parquet output (gitignored)
data/reports/                 quality_report.csv / quality_report.md
visitwell_pipeline/
  ingest.py                   bronze
  clean/                      silver: influenza, dengue, measles+population+malaria, reference files
  quality.py                  quality report
  gold/                       seasonal, flu_realtime, measles_status, outlook (presence, destination_outlook), app_tables
  api.py                      get_outlook()
  sinks.py                    LocalSink / DatabricksSqlSink (laptop push) / SparkSink (notebook)
  run.py                      orchestrator used by both the CLI and the notebook
databricks/visitwell_pipeline_job.py   Databricks notebook / job entry point
dt_preproc.py                 CLI
build_geo.py                  map coordinates seed + the app's destination list and country outlines (Natural Earth)
tests/                        pytest, synthetic fixtures, no network
```

## Scope

| Disease | Method | Source | Card group |
|---|---|---|---|
| Influenza | real-time if departure ≤ 21 days, otherwise seasonal | WHO FluNet | respiratory |
| COVID-19 | vaccine reminder only (no data pipeline) | config text, linked to PHAC | respiratory |
| Dengue | seasonal | OpenDengue V1.3 | mosquito |
| Malaria | present if WHO estimates any cases in the latest year, else not_reported | WHO GHO (+ MAP) | mosquito |
| Yellow fever | no data source yet → `unknown` (hidden in the app) | none | mosquito |
| Measles | recent activity (12-month incidence) + always a vaccine check | WHO provisional monthly data | measles |
| Hepatitis A | no data source yet → `unknown` (hidden in the app) | none | food_water |
| Typhoid | no data source yet → `unknown` (hidden in the app) | none | food_water |

Destinations: `destinations: all` runs every country code (about 250; a full local run takes under a minute).
A list such as `[VNM, PHL, BRA]` restricts the run. The app's destination list is generated from the results (below).

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

## Reference files (no health facts)

Every health level comes from a downloaded source. There are no hand-written health facts: the former
presence, vaccine, yellow fever entry and alert seeds were removed. The only hand-maintained file is map geometry:

| File | Key columns |
|---|---|
| `data/seeds/admin1_centroids_seed.csv` | location_iso3, admin1 (empty = national), latitude, longitude: map dot positions from Natural Earth 10m label points |

It also has `source_name, source_url, checked_on, verified, needs_review, notes`. A row is used only if
`verified=true` and it has `source_url` and `checked_on`.

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
* **population**, **seed_centroids**: population, and validated map coordinates.

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
* **presence**: from downloaded data only. Malaria: WHO estimated incidence (latest year) > 0 → `present`, 0 →
  `not_reported`, no estimate → `unknown`. Yellow fever, hepatitis A and typhoid: `unknown` (no source yet).
* **alerts**: no alert source is wired in, so the measles `outbreak` override is inactive until one is added.
* **destination_outlook**: disease levels per destination (read by the app, see below).
* **monthly_cases**: one row per disease × location × admin1 × month for the last `app.series_months` (24) months of
  each series, counted back from that series' latest reported month. `metric` is `lab_confirmed_positives`
  (influenza, FluNet positives) or `reported_cases` (dengue, measles). Unreported months stay null. The month
  holding FluNet's latest week is dropped until that week reaches the month's end, so a partial month never
  looks like a drop.
* **disease_trend**: latest month's count plus a trend: the last `app.trend_window_months` (3) months against the
  3 before, `increasing` at a ratio ≥ 1.25, `decreasing` at ≤ 0.8, otherwise `stable` (**placeholder thresholds
  that need review**). A gap in those 6 months, or a latest month older than `app.trend_max_age_months` (12),
  gives `unknown` with the reason in `trend_note`.
* **map_points**: one dot per disease × place for the map, using the latest month's count. Admin1 dots are used when
  the admin1 series is no older than `app.map_max_age_months` (24) and has coordinates in the centroids seed
  (today: dengue in Brazil's states). Otherwise there is one national dot.

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

Dengue has no presence gate: its seasonal rows come straight from the case data, and a place with too few complete
years gets `unknown`. Unknown rows stay in the table (with the reason in `notes`); the app hides them.

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
| `visitwell.silver` | influenza_weekly, influenza_monthly, dengue_monthly, measles_monthly, malaria_annual, population, seed_centroids, quality_report |
| `visitwell.gold` | seasonal_profile, flu_realtime, measles_status, presence, **destination_outlook**, **monthly_cases**, **disease_trend**, **map_points** |

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

## How the web app reads the data
The frontend calls the TanStack Start server function `getLiveReport` (`frontend/src/data/report.functions.ts`).
It queries `destination_outlook`, `disease_trend`, `monthly_cases` and `map_points` for one `location_iso3`
through the Databricks SQL Statement Execution API (`frontend/src/server/databricks.server.ts`). Then
`frontend/src/data/report-mapping.ts` maps them to the UI shape. It applies the trip window and the 21-day
real-time influenza rule, and maps each level to elevated / moderate / low / unknown. The server needs the same
`DATABRICKS_HOST`, `DATABRICKS_TOKEN` and `DATABRICKS_HTTP_PATH` variables in its environment. If the live call
fails, destinations that have a demo dataset fall back to it, labelled as demo data.

## Geography for the app (`build_geo.py`)
Natural Earth files are downloaded once into `data/raw/naturalearth/`.
* `python build_geo.py centroids` (after silver) rewrites `data/seeds/admin1_centroids_seed.csv`: one label point
  per country plus every dengue admin1 region whose name matches Natural Earth (some do not, e.g. Nepal's post-2015
  provinces; those series use the national point).
* `python build_geo.py frontend` (after gold) writes `frontend/src/data/destinations.generated.ts` (every country
  with at least one known disease level: name, region, camera centre/zoom, search aliases) and one outline per
  country in `frontend/public/shapes/<id>.json` (50m, loaded on demand).

Full refresh: `dt_preproc.py --steps bronze silver` → `build_geo.py centroids` → `dt_preproc.py --steps gold`
→ `build_geo.py frontend`, then push with `--sink databricks`.

## Tests
`python -m pytest`: seasonal index and labels, insufficient years, excluded years, consistency, percentile
labels and boundaries, freshness fallback (at build time and at query time), dengue without a presence gate, malaria from WHO incidence,
the 21-day switch boundary, measles thresholds, staleness and alert override, the missing-data → unknown rule
(influenza, measles, dengue, malaria), week-to-month splitting, the FluNet dictionary check, and Delta-safe columns.
The tests do no network or file I/O beyond pytest's tmp dir.

## Known limitations / to review
* Yellow fever, hepatitis A and typhoid have no data source, so the app does not show them. Candidates: WHO's list of
  countries with yellow fever risk, and IHME GBD incidence estimates for hepatitis A and typhoid.
* Malaria `present` only says WHO estimates some cases; it does not say where in the country (MAP admin1 would).
* The measles `high_incidence_per_million` threshold is a placeholder.
* Measles data for Vietnam in the WHO file currently ends 2025-02, so it shows as `unknown` (stale).
* India has too few complete years of monthly dengue data in OpenDengue V1.3, so its dengue level is `unknown`.
* Admin1 dengue profiles mostly cover older years (e.g. VNM/PHL up to 2010); `data_as_of` shows this.
* MAP admin1 malaria is not included until a manual export is added.
* Mexico's state-level dengue series end more than 24 months ago, so Mexico shows a national dengue dot.
