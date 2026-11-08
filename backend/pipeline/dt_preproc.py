"""VisitWell preprocessing CLI.

Examples
  python dt_preproc.py                              # all steps, local parquet only
  python dt_preproc.py --sink databricks            # all steps, local + push Delta tables (uses .env)
  python dt_preproc.py --steps silver gold          # re-run from existing bronze parquet
  python dt_preproc.py --offline                    # never download; use files already in data/raw
  python dt_preproc.py outlook VNM 2027-01-25 2027-02-20 [--admin1 "Ho Chi Minh"] [--today YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import sys

from visitwell_pipeline.config import load_config
from visitwell_pipeline.sinks import DatabricksSqlSink, LocalSink, MultiSink


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="run", choices=["run", "outlook"])
    ap.add_argument("args", nargs="*", help="for outlook: ISO3 START END")
    ap.add_argument("--config", default=None)
    ap.add_argument("--steps", nargs="+", default=["bronze", "silver", "gold"], choices=["bronze", "silver", "gold"])
    ap.add_argument("--sink", choices=["local", "databricks"], default="local")
    ap.add_argument("--offline", action="store_true", help="do not download; use data/raw only")
    ap.add_argument("--refresh", action="store_true", help="re-download sources even if cached")
    ap.add_argument("--as-of", default=None, help="run date for freshness checks (YYYY-MM-DD)")
    ap.add_argument("--admin1", default=None)
    ap.add_argument("--today", default=None)
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config(a.config)

    if a.command == "outlook":
        from visitwell_pipeline.api import get_outlook
        iso, start, end = a.args
        res = get_outlook(iso, dt.date.fromisoformat(start), dt.date.fromisoformat(end),
                          today=dt.date.fromisoformat(a.today) if a.today else None, admin1=a.admin1, cfg=cfg)
        print(json.dumps(res, indent=2, default=str))
        return 0

    from visitwell_pipeline.run import run_all
    local = LocalSink(cfg)
    sink = MultiSink(local, DatabricksSqlSink(cfg)) if a.sink == "databricks" else MultiSink(local)
    try:
        run_all(cfg, sink, steps=a.steps, offline=a.offline, refresh=a.refresh,
                as_of=dt.date.fromisoformat(a.as_of) if a.as_of else None)
    finally:
        sink.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
