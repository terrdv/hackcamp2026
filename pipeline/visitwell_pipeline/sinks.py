"""Where pipeline tables are written.

* LocalSink         -> data/<layer>/<name>.parquet (always used, also the input for later steps)
* DatabricksSqlSink -> Unity Catalog Delta tables via a SQL warehouse (local push; uses .env)
* SparkSink         -> Unity Catalog Delta tables from inside a Databricks notebook/job

Both Databricks sinks create the catalog / schemas / volume on first use, so no table has to exist
beforehand. DatabricksSqlSink writes each table with CREATE OR REPLACE. SparkSink (the daily job) MERGEs by
default: existing tables are kept and only new / changed rows are written.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import re
import tempfile
from pathlib import Path

import pandas as pd

log = logging.getLogger(__name__)


def sanitize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Delta column names may not contain spaces or ,;{}()=\\n\\t."""
    def clean(c):
        c = re.sub(r"[^0-9A-Za-z_]+", "_", str(c).strip()).strip("_").lower()
        return c or "col"
    cols, seen = [], {}
    for c in df.columns:
        n = clean(c)
        if n in seen:
            seen[n] += 1
            n = f"{n}_{seen[n]}"
        else:
            seen[n] = 0
        cols.append(n)
    out = df.copy()
    out.columns = cols
    return out


def prepare_for_parquet(df: pd.DataFrame, sanitize: bool = True) -> pd.DataFrame:
    """Make dtypes parquet/Delta friendly (no mixed object columns, no all-null 'void' columns)."""
    out = sanitize_columns(df) if sanitize else df.copy()
    for c in out.columns:
        s = out[c]
        if s.dtype == object:
            nn = s.dropna()
            if nn.empty:
                out[c] = s.astype("string")
            elif nn.map(lambda v: isinstance(v, dt.date) and not isinstance(v, dt.datetime)).all():
                pass  # pyarrow -> date32
            elif not nn.map(lambda v: isinstance(v, str)).all():
                out[c] = s.map(lambda v: None if v is None or (isinstance(v, float) and v != v) else str(v)).astype("string")
    return out


class LocalSink:
    def __init__(self, cfg):
        self.cfg = cfg

    def write(self, layer: str, name: str, df: pd.DataFrame, comment: str | None = None) -> Path:
        d = self.cfg.path(layer)
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{name}.parquet"
        prepare_for_parquet(df, sanitize=False).to_parquet(p, index=False)
        log.info("local  %-6s %-28s %8d rows -> %s", layer, name, len(df), p)
        return p

    def read(self, layer: str, name: str) -> pd.DataFrame:
        return pd.read_parquet(self.cfg.path(layer) / f"{name}.parquet")

    def upload_raw(self, local: Path, rel: str):  # nothing to do locally
        return None


class _UCBase:
    def __init__(self, cfg):
        db = cfg["databricks"]
        self.catalog = db["catalog"]
        self.schemas = db["schemas"]
        self.volume = db["volume"]
        self.volume_root = f"/Volumes/{self.catalog}/{self.schemas['bronze']}/{self.volume}"
        self._ready = False

    def fqn(self, layer, name):
        return f"`{self.catalog}`.`{self.schemas[layer]}`.`{name}`"

    def ddl(self):
        yield f"CREATE CATALOG IF NOT EXISTS `{self.catalog}`"
        for layer, schema in self.schemas.items():
            yield (f"CREATE SCHEMA IF NOT EXISTS `{self.catalog}`.`{schema}` "
                   f"COMMENT 'VisitWell {layer} layer'")
        yield (f"CREATE VOLUME IF NOT EXISTS `{self.catalog}`.`{self.schemas['bronze']}`.`{self.volume}` "
               "COMMENT 'VisitWell raw file archive and parquet staging'")


class DatabricksSqlSink(_UCBase):
    """Push from a laptop: parquet -> UC volume (Files API) -> CREATE OR REPLACE TABLE via SQL warehouse."""

    def __init__(self, cfg, env_file: str | Path | None = None):
        super().__init__(cfg)
        from dotenv import load_dotenv
        # pipeline/.env wins, then the repo-root .env shared with the app
        root = Path(cfg["_root"])
        for p in ([Path(env_file)] if env_file else []) + [root / ".env", root.parent / ".env"]:
            if p.exists():
                load_dotenv(p)
        for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_HTTP_PATH"):
            if not os.environ.get(k):
                raise RuntimeError(f"{k} is not set (expected in pipeline/.env or the repo-root .env)")
        self.host = os.environ["DATABRICKS_HOST"].rstrip("/")
        if not self.host.startswith("http"):
            self.host = "https://" + self.host
        self._conn = None
        self._ws = None

    @property
    def ws(self):
        if self._ws is None:
            from databricks.sdk import WorkspaceClient
            self._ws = WorkspaceClient(host=self.host, token=os.environ["DATABRICKS_TOKEN"])
        return self._ws

    def sql(self, statement: str):
        from databricks import sql as dbsql
        if self._conn is None:
            self._conn = dbsql.connect(server_hostname=self.host.replace("https://", ""),
                                       http_path=os.environ["DATABRICKS_HTTP_PATH"],
                                       access_token=os.environ["DATABRICKS_TOKEN"])
        with self._conn.cursor() as cur:
            cur.execute(statement)
            try:
                return cur.fetchall()
            except Exception:
                return None

    def ensure(self):
        if not self._ready:
            for s in self.ddl():
                self.sql(s)
            self._ready = True

    def _upload(self, local: Path, remote: str):
        with open(local, "rb") as fh:
            self.ws.files.upload(remote, fh, overwrite=True)

    def write(self, layer: str, name: str, df: pd.DataFrame, comment: str | None = None):
        self.ensure()
        remote = f"{self.volume_root}/_staging/{layer}/{name}.parquet"
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / f"{name}.parquet"
            prepare_for_parquet(df).to_parquet(p, index=False)
            self._upload(p, remote)
        self.sql(f"CREATE OR REPLACE TABLE {self.fqn(layer, name)} AS "
                 f"SELECT * FROM read_files('{remote}', format => 'parquet')")
        if comment:
            self.sql(f"COMMENT ON TABLE {self.fqn(layer, name)} IS '{comment.replace(chr(39), '')}'")
        log.info("delta  %-6s %-28s %8d rows -> %s", layer, name, len(df), self.fqn(layer, name))

    def upload_raw(self, local: Path, rel: str):
        self.ensure()
        remote = f"{self.volume_root}/raw/{rel}"
        self._upload(local, remote)
        log.info("volume raw %s -> %s", local.name, remote)
        return remote

    def close(self):
        if self._conn is not None:
            self._conn.close()
            self._conn = None


# --- incremental (MERGE) writes ------------------------------------------------------------
# Columns that change on every run without the data changing. They are stored but left out of the
# row hash, so an unchanged row is not rewritten (after a merge they mean "date this row last changed").
# sanitize_columns strips leading underscores, so the stored names are listed (not _retrieved_at etc.).
VOLATILE_COLUMNS = frozenset({"retrieved_at", "file_sha256", "file", "built_on", "computed_on",
                              "ingested_at"})
# Columns Databricks adds itself (read_files in the laptop push adds _rescued_data). They exist only in the
# target table; the merge leaves them null for new rows and never treats them as dropped.
SYSTEM_COLUMNS = frozenset({"_rescued_data"})
# Run logs: every run appends its rows (history of source hashes), never merged.
APPEND_TABLES = frozenset({"ingest_log"})


class SchemaDriftError(RuntimeError):
    """Incoming table drops or retypes a column; refuse to merge instead of silently rebuilding."""


def hash_columns(columns) -> list[str]:
    """Business columns that define row identity, in a stable (sorted) order."""
    return sorted(c for c in columns if c.lstrip("_") not in VOLATILE_COLUMNS)


def row_hash_sql(columns, alias: str | None = None) -> str:
    """Spark SQL expression: sha256 over the business columns. Same expression for source and target."""
    pre = f"{alias}." if alias else ""
    parts = ", ".join(f"coalesce(cast({pre}`{c}` as string), '<null>')" for c in hash_columns(columns))
    return f"sha2(concat_ws(char(31), {parts}), 256)"


_TYPE_FAMILIES = (
    {"tinyint", "smallint", "int", "bigint", "float", "double"},
    {"date", "timestamp", "timestamp_ntz"},
)


def _compatible(old: str, new: str) -> bool:
    """Incoming type `new` can be cast to the existing column type `old` without losing meaning."""
    if old == "string":
        return True
    fam = lambda t: next((i for i, f in enumerate(_TYPE_FAMILIES)
                          if t in f or (i == 0 and t.startswith("decimal"))), None)
    return fam(old) is not None and fam(old) == fam(new)


def plan_merge(existing: dict[str, str] | None, incoming: dict[str, str]) -> dict:
    """Decide how to write. Schemas are {column: spark simpleString type}.

    Returns {"action": "create"} or {"action": "merge", "add_columns": {col: type}, "casts": {col: type}}.
    `casts` aligns compatible type differences (e.g. int vs bigint) to the existing table's type.
    Raises SchemaDriftError when the incoming frame drops a column or changes a type incompatibly.
    """
    if existing is None:
        return {"action": "create"}
    dropped = sorted(set(existing) - set(incoming) - SYSTEM_COLUMNS)
    casts = {c: existing[c] for c in incoming if c in existing and existing[c] != incoming[c]}
    bad = {c: (existing[c], incoming[c]) for c in casts if not _compatible(existing[c], incoming[c])}
    if dropped or bad:
        raise SchemaDriftError(
            f"dropped columns {dropped}, incompatible type changes {bad} - "
            "run the job once with write_mode=overwrite to rebuild this table")
    return {"action": "merge", "casts": casts,
            "add_columns": {c: t for c, t in incoming.items() if c not in existing}}


def merge_sql(target: str, source_view: str, columns, casts: dict[str, str] | None = None) -> str:
    """MERGE that inserts rows whose hash is new and deletes rows whose hash is gone; untouched otherwise."""
    cols, casts = list(columns), casts or {}
    select = ", ".join(f"cast(`{c}` as {casts[c]}) AS `{c}`" if c in casts else f"`{c}`" for c in cols)
    col_list = ", ".join(f"`{c}`" for c in cols)
    val_list = ", ".join(f"s.`{c}`" for c in cols)
    return (f"MERGE INTO {target} AS t\n"
            f"USING (SELECT *, {row_hash_sql(cols)} AS __row_hash FROM (SELECT {select} FROM {source_view})) AS s\n"
            f"ON {row_hash_sql(cols, 't')} = s.__row_hash\n"
            f"WHEN NOT MATCHED THEN INSERT ({col_list}) VALUES ({val_list})\n"
            f"WHEN NOT MATCHED BY SOURCE THEN DELETE")


class SparkSink(_UCBase):
    """Inside Databricks: pandas -> parquet on the (FUSE-mounted) volume -> Delta table.

    write_mode="merge" (default): existing tables are kept; only new / changed rows are inserted and rows
    that disappeared from the source are deleted (row identity = hash of the business columns).
    write_mode="overwrite": full rebuild of every table (manual escape hatch).
    """

    def __init__(self, cfg, spark, write_mode: str = "merge"):
        super().__init__(cfg)
        if write_mode not in ("merge", "overwrite"):
            raise ValueError(f"write_mode must be merge or overwrite, got {write_mode!r}")
        self.spark = spark
        self.write_mode = write_mode
        self.stats: list[dict] = []

    def ensure(self):
        if not self._ready:
            for s in self.ddl():
                self.spark.sql(s)
            self._ready = True

    def _schema(self, sdf) -> dict[str, str]:
        return {f.name: f.dataType.simpleString() for f in sdf.schema.fields}

    def _last_metrics(self, table: str) -> dict:
        row = self.spark.sql(f"DESCRIBE HISTORY {table} LIMIT 1").collect()[0]
        return dict(row["operationMetrics"] or {})

    def write(self, layer: str, name: str, df: pd.DataFrame, comment: str | None = None):
        self.ensure()
        path = Path(f"{self.volume_root}/_staging/{layer}/{name}.parquet")
        path.parent.mkdir(parents=True, exist_ok=True)
        # Spark cannot read pandas' nanosecond timestamps: store them as microseconds
        prepare_for_parquet(df).to_parquet(path, index=False, coerce_timestamps="us",
                                           allow_truncated_timestamps=True)
        sdf = self.spark.read.parquet(str(path))
        table = self.fqn(layer, name)
        plain = table.replace("`", "")
        exists = self.spark.catalog.tableExists(plain)

        if self.write_mode == "overwrite":
            action = "overwrite"
            sdf.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(plain)
        elif name in APPEND_TABLES:
            action = "append"
            sdf.write.format("delta").mode("append").option("mergeSchema", "true").saveAsTable(plain)
        else:
            plan = plan_merge(self._schema(self.spark.table(plain)) if exists else None, self._schema(sdf))
            action = plan["action"]
            if action == "create":
                sdf.write.format("delta").saveAsTable(plain)
            else:
                if plan["add_columns"]:
                    cols = ", ".join(f"`{c}` {t}" for c, t in plan["add_columns"].items())
                    self.spark.sql(f"ALTER TABLE {table} ADD COLUMNS ({cols})")
                view = f"_visitwell_src_{layer}_{name}"
                sdf.createOrReplaceTempView(view)
                self.spark.sql(merge_sql(table, view, sdf.columns, plan["casts"]))
                self.spark.catalog.dropTempView(view)

        if comment:
            self.spark.sql(f"COMMENT ON TABLE {table} IS '{comment.replace(chr(39), '')}'")
        m = self._last_metrics(table) if action in ("merge", "append") else {}
        stat = dict(layer=layer, table=name, action=action, rows=len(df),
                    inserted=int(m.get("numTargetRowsInserted", m.get("numOutputRows", 0)) or 0),
                    deleted=int(m.get("numTargetRowsDeleted", 0) or 0))
        self.stats.append(stat)
        log.info("delta  %-6s %-28s %8d rows  %-9s +%d -%d", layer, name, len(df), action,
                 stat["inserted"], stat["deleted"])

    def upload_raw(self, local: Path, rel: str):
        return None  # in the notebook raw files are already read from the volume


class MultiSink:
    """Write to several sinks; the first one must be a LocalSink (used for reads)."""

    def __init__(self, *sinks):
        self.sinks = sinks

    def write(self, layer, name, df, comment=None):
        for s in self.sinks:
            s.write(layer, name, df, comment)

    def upload_raw(self, local, rel):
        for s in self.sinks:
            s.upload_raw(local, rel)

    def read(self, layer, name):
        return self.sinks[0].read(layer, name)

    def close(self):
        for s in self.sinks:
            if hasattr(s, "close"):
                s.close()
