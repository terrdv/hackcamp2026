# Databricks notebook source
# MAGIC %md
# MAGIC # VisitWell pipeline (bronze → silver → gold)
# MAGIC Runs the same `visitwell_pipeline` functions as the local CLI and saves every layer as Delta tables in
# MAGIC Unity Catalog (`visitwell.bronze`, `visitwell.silver`, `visitwell.gold`). Tables are created on first run.
# MAGIC
# MAGIC * Raw files live in the volume `/Volumes/visitwell/bronze/landing/raw/` (the local `--sink databricks`
# MAGIC   push archives them there). Manual files (MAP malaria exports) go in `raw/malaria/map_*.csv`.
# MAGIC * The app reads only `visitwell.gold.destination_outlook`.
# MAGIC * Scheduled daily by the `visitwell_daily` job (`databricks.yml`). Parameters: `steps`, `offline`, `as_of`,
# MAGIC   `refresh` (re-download sources), `write_mode` (`merge` = only new/changed rows, `overwrite` = full rebuild),
# MAGIC   `force` (rebuild silver even if no source changed).
# MAGIC * With the default `steps=bronze,silver,gold` the run is incremental: silver is skipped when no source file
# MAGIC   and no pipeline code changed; every table is MERGEd, so existing tables are never replaced.

# COMMAND ----------

# MAGIC %pip install -q pyyaml pycountry openpyxl requests

# COMMAND ----------

dbutils.widgets.text("steps", "bronze,silver,gold")
dbutils.widgets.dropdown("offline", "false", ["true", "false"])
dbutils.widgets.text("as_of", "")          # YYYY-MM-DD; empty = today
dbutils.widgets.dropdown("refresh", "true", ["true", "false"])
dbutils.widgets.dropdown("write_mode", "merge", ["merge", "overwrite"])
dbutils.widgets.dropdown("force", "false", ["true", "false"])

# COMMAND ----------

import datetime as dt
import logging
import os
import sys
from pathlib import Path

# repo root = parent of this notebook's folder (works for Git folders and workspace files)
nb_dir = Path(os.getcwd())
root = nb_dir.parent if (nb_dir.parent / "visitwell_pipeline").exists() else nb_dir
sys.path.insert(0, str(root))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", force=True)

from visitwell_pipeline.config import load_config
from visitwell_pipeline.run import STEPS, run_all, run_incremental
from visitwell_pipeline.sinks import LocalSink, MultiSink, SparkSink

base = load_config(root=root)
db = base["databricks"]
vol = f"/Volumes/{db['catalog']}/{db['schemas']['bronze']}/{db['volume']}"
cfg = load_config(root=root, overrides={"paths": {
    "raw": f"{vol}/raw", "seeds": str(root / "data" / "seeds"),
    "bronze": f"{vol}/work/bronze", "silver": f"{vol}/work/silver",
    "gold": f"{vol}/work/gold", "reports": f"{vol}/work/reports"}})
cfg["databricks"]["upload_raw_files"] = False

spark_sink = SparkSink(cfg, spark, write_mode=dbutils.widgets.get("write_mode"))
spark_sink.ensure()                     # catalog / schemas / volume
sink = MultiSink(LocalSink(cfg), spark_sink)

steps = [s.strip() for s in dbutils.widgets.get("steps").split(",") if s.strip()]
offline = dbutils.widgets.get("offline") == "true"
as_of = dbutils.widgets.get("as_of") or None
as_of = dt.date.fromisoformat(as_of) if as_of else None
refresh = dbutils.widgets.get("refresh") == "true"
force = dbutils.widgets.get("force") == "true"

if tuple(steps) == STEPS:
    result = run_incremental(cfg, sink, refresh=refresh, offline=offline, as_of=as_of, force=force)
    dbutils.jobs.taskValues.set("changed_sources", result["changed_sources"])
    dbutils.jobs.taskValues.set("silver_rebuilt", result["silver_rebuilt"])
else:
    run_all(cfg, sink, steps=steps, offline=offline, refresh=refresh, as_of=as_of)

# COMMAND ----------

import pandas as pd
stats = pd.DataFrame(spark_sink.stats)
print(f"rows inserted: {stats.inserted.sum()}  deleted: {stats.deleted.sum()}")
display(stats)

# COMMAND ----------

display(spark.table(f"{db['catalog']}.{db['schemas']['gold']}.destination_outlook"))

# COMMAND ----------

print(open(f"{vol}/work/reports/quality_report.md").read())
