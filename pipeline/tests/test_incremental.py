"""Incremental daily job: merge planning, row-hash SQL, source-change detection. No Spark needed."""
from __future__ import annotations

import json

import pandas as pd
import pytest

from visitwell_pipeline.ingest import changed_sources, previous_hashes
from visitwell_pipeline.run import code_fingerprint, needs_silver
from visitwell_pipeline.sinks import (SchemaDriftError, hash_columns, merge_sql, plan_merge,
                                      row_hash_sql)


def test_hash_ignores_volatile_columns_and_order():
    a = hash_columns(["location_iso3", "built_on", "level", "_retrieved_at", "computed_on"])
    b = hash_columns(["level", "computed_on", "location_iso3"])
    assert a == b == ["level", "location_iso3"]
    assert row_hash_sql(["level", "built_on", "location_iso3"]) == row_hash_sql(["location_iso3", "level"])


def test_hash_ignores_provenance_columns_after_sanitizing():
    from visitwell_pipeline.sinks import sanitize_columns
    import pandas as pd
    stored = list(sanitize_columns(pd.DataFrame(columns=["COUNTRY_CODE", "_source", "_retrieved_at",
                                                          "_file_sha256", "_file"])).columns)
    assert hash_columns(stored) == ["country_code", "source"]


def test_hash_sql_same_expression_for_target_alias():
    src, tgt = row_hash_sql(["a", "b"]), row_hash_sql(["a", "b"], "t")
    assert src.replace("`a`", "t.`a`").replace("`b`", "t.`b`") == tgt
    assert "coalesce(" in src and "sha2(" in src     # nulls hash deterministically


def test_plan_merge_create_when_table_missing():
    assert plan_merge(None, {"a": "string"}) == {"action": "create"}


def test_plan_merge_keeps_existing_table_and_adds_columns():
    p = plan_merge({"a": "string", "b": "bigint"}, {"a": "string", "b": "bigint", "c": "double"})
    assert p == {"action": "merge", "casts": {}, "add_columns": {"c": "double"}}


def test_plan_merge_ignores_rescued_data_from_read_files():
    p = plan_merge({"a": "string", "_rescued_data": "string"}, {"a": "string"})
    assert p == {"action": "merge", "casts": {}, "add_columns": {}}


def test_plan_merge_casts_compatible_types():
    p = plan_merge({"n": "bigint", "d": "timestamp", "s": "string"},
                   {"n": "int", "d": "timestamp_ntz", "s": "double"})
    assert p["casts"] == {"n": "bigint", "d": "timestamp", "s": "string"}


@pytest.mark.parametrize("existing,incoming", [
    ({"a": "string", "b": "bigint"}, {"a": "string"}),        # dropped column
    ({"a": "double"}, {"a": "string"}),                        # incompatible retype
    ({"a": "date"}, {"a": "bigint"}),
])
def test_plan_merge_refuses_drift(existing, incoming):
    with pytest.raises(SchemaDriftError, match="write_mode=overwrite"):
        plan_merge(existing, incoming)


def test_merge_sql_inserts_new_deletes_gone_never_replaces():
    sql = merge_sql("`visitwell`.`gold`.`x`", "v", ["a", "built_on"], {"a": "bigint"})
    assert sql.startswith("MERGE INTO `visitwell`.`gold`.`x`")
    assert "WHEN NOT MATCHED THEN INSERT (`a`, `built_on`)" in sql
    assert "WHEN NOT MATCHED BY SOURCE THEN DELETE" in sql
    assert "cast(`a` as bigint)" in sql
    assert "REPLACE" not in sql.upper()


def _log(rows):
    return pd.DataFrame(rows, columns=["source", "file", "sha256"])


def test_changed_sources_detects_new_changed_and_missing():
    prev = {"f/flu.csv": "h1", "d/den.csv": "h2", "m/mea.xlsx": "h3"}
    log = _log([("flunet", "f/flu.csv", "h1"),          # unchanged
                ("opendengue", "d/den.csv", "NEW"),     # changed
                ("measles", "m/mea.xlsx", None),        # went missing
                ("population", "p/pop.json", "h4"),     # new
                ("malaria_map", "malaria/map_*.csv", None)])  # never present -> not a change
    assert changed_sources(prev, log) == ["measles", "opendengue", "population"]
    assert changed_sources({"f/flu.csv": "h1"}, _log([("flunet", "f/flu.csv", "h1")])) == []


def test_previous_hashes_reads_manifest(tmp_path):
    assert previous_hashes(tmp_path) == {}
    (tmp_path / "_manifest.json").write_text(json.dumps({"a.csv": {"sha256": "x"}, "b.csv": {"url": "u"}}))
    assert previous_hashes(tmp_path) == {"a.csv": "x"}


def test_needs_silver():
    assert not needs_silver([], code_changed=False, silver_present=True, force=False)
    assert needs_silver(["flunet"], False, True, False)
    assert needs_silver([], True, True, False)
    assert needs_silver([], False, False, False)
    assert needs_silver([], False, True, True)


def test_code_fingerprint_changes_with_config(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "visitwell_pipeline").mkdir()
    (tmp_path / "config" / "pipeline.yaml").write_text("a: 1")
    fp = code_fingerprint(tmp_path)
    assert code_fingerprint(tmp_path) == fp
    (tmp_path / "config" / "pipeline.yaml").write_text("a: 2")
    assert code_fingerprint(tmp_path) != fp
