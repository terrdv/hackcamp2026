# VisitWell (HackCamp 2026)

VisitWell tells travellers which infectious diseases matter at their destination for their travel dates, and
what to do about them. It describes disease activity compared with what is normal there, and always shows how
recent the data is. It does not estimate personal infection risk.

## Repository layout

| Path | What |
|---|---|
| `pipeline/` | Python data pipeline (bronze → silver → gold) that builds the disease outlook and pushes it to Databricks. See [pipeline/README.md](pipeline/README.md). |
| *(repo root)* | TanStack web app (to be added) |
| `.env` | Shared secrets (gitignored). Template: `.env.example` |

## How the app gets its data

The pipeline writes a single table for the app: **`visitwell.gold.destination_outlook`** in Databricks (also
written locally to `pipeline/data/gold/destination_outlook.{parquet,csv}`). It has one row per destination ×
disease × month, with `level`, `based_on`, `data_as_of`, `source` and `notes`. The schema and trip logic (21-day
influenza switch, reminders, admin1 fallback) are documented in [pipeline/README.md](pipeline/README.md), and
`get_outlook()` in `pipeline/visitwell_pipeline/api.py` is the reference implementation.

## Refreshing the data

```bash
cd pipeline
.venv/Scripts/python dt_preproc.py --sink databricks
```
