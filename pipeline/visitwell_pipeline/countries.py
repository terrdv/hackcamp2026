"""Country standardisation to ISO3 and admin1 name normalisation."""
from __future__ import annotations

import re
import unicodedata

import pycountry

# Names/codes seen in sources that pycountry does not resolve on its own.
OVERRIDES = {
    "VIET NAM": "VNM", "VIETNAM": "VNM",
    "PHILIPPINES (THE)": "PHL",
    "CHINA, PEOPLE'S REPUBLIC OF": "CHN",
    "BRASIL": "BRA",
    "MEXICO": "MEX", "MÉXICO": "MEX",
    "KOSOVO": "XKX",  # WHO-defined code, not ISO
}


def to_iso3(value) -> str | None:
    """Return the ISO3 code for an ISO3/ISO2 code or a country name; None if unresolvable."""
    if value is None or (isinstance(value, float) and value != value):
        return None
    s = str(value).strip()
    if not s:
        return None
    up = s.upper()
    if up in OVERRIDES:
        return OVERRIDES[up]
    if len(up) == 3 and pycountry.countries.get(alpha_3=up):
        return up
    if len(up) == 2:
        c = pycountry.countries.get(alpha_2=up)
        if c:
            return c.alpha_3
    try:
        return pycountry.countries.lookup(s).alpha_3
    except LookupError:
        pass
    try:
        hits = pycountry.countries.search_fuzzy(s)
        return hits[0].alpha_3 if len(hits) == 1 else None
    except LookupError:
        return None


def admin1_key(name) -> str | None:
    """Accent/case/punctuation-insensitive key for matching admin1 names across sources."""
    if name is None or (isinstance(name, float) and name != name):
        return None
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9]+", " ", s).strip().upper()
    return s or None
