"""Load and lightly validate config/pipeline.yaml."""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "config" / "pipeline.yaml"

REQUIRED_KEYS = ["destinations", "paths", "sources", "influenza", "dengue", "seasonal",
                 "measles", "seeds", "card_groups", "reminders", "databricks"]


class Config(dict):
    """dict with helpers for resolved paths."""

    def path(self, key: str) -> Path:
        p = Path(self["paths"][key])
        return p if p.is_absolute() else Path(self["_root"]) / p

    def raw(self, rel: str) -> Path:
        return self.path("raw") / rel

    def seed(self, name: str) -> Path:
        return self.path("seeds") / self["seeds"]["files"][name]


def load_config(path: str | Path | None = None, overrides: dict[str, Any] | None = None,
                root: str | Path | None = None) -> Config:
    path = Path(path) if path else DEFAULT_CONFIG
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    missing = [k for k in REQUIRED_KEYS if k not in data]
    if missing:
        raise ValueError(f"config {path} missing keys: {missing}")
    if overrides:
        data = deep_merge(data, overrides)
    data["destinations"] = resolve_destinations(data["destinations"])
    cfg = Config(data)
    cfg["_root"] = str(Path(root) if root else REPO_ROOT)
    return cfg


def resolve_destinations(value) -> list[str]:
    """`all` -> every ISO 3166 country code (plus WHO's XKX for Kosovo); otherwise the listed ISO3 codes."""
    if isinstance(value, str) and value.strip().lower() == "all":
        import pycountry
        return sorted({c.alpha_3 for c in pycountry.countries} | {"XKX"})
    return [d.strip().upper() for d in value]


def deep_merge(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out
