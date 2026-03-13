"""
data/fetch.py

Two data sources:
  1. US Treasury XML feed  — daily par yields for bootstrapping
  2. FRED API              — historical yield data for PCA / backtesting

Usage:
    from data.fetch import fetch_treasury_yields, fetch_fred_series

    par_yields = fetch_treasury_yields()          # latest available day
    historical = fetch_fred_series(["DGS2", "DGS10"], years=5)
"""

import urllib.request
import urllib.parse
import json
import xml.etree.ElementTree as ET
from datetime import date, timedelta


# ── TREASURY ──────────────────────────────────────────────────────────────────

TREASURY_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/"
    "interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month={ym}"
)

TREASURY_FIELDS = {
    "BC_1MONTH":  0.083,
    "BC_2MONTH":  0.167,
    "BC_3MONTH":  0.25,
    "BC_6MONTH":  0.5,
    "BC_1YEAR":   1.0,
    "BC_2YEAR":   2.0,
    "BC_3YEAR":   3.0,
    "BC_5YEAR":   5.0,
    "BC_7YEAR":   7.0,
    "BC_10YEAR":  10.0,
    "BC_20YEAR":  20.0,
    "BC_30YEAR":  30.0,
}


def fetch_treasury_yields(target_date=None):
    """
    Fetch par yields from the US Treasury XML feed.

    Returns:
        {
            "date":   "2024-01-15",
            "yields": {0.5: 5.30, 1.0: 5.10, 2.0: 4.80, ...}
        }
    """
    if target_date is None:
        target_date = date.today()
    elif isinstance(target_date, str):
        target_date = date.fromisoformat(target_date)

    for months_back in range(3):
        d = target_date - timedelta(days=30 * months_back)
        ym = d.strftime("%Y%m")
        url = TREASURY_URL.format(ym=ym)
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                xml_data = resp.read().decode("utf-8")
            result = _parse_treasury_xml(xml_data, target_date)
            if result:
                return result
        except Exception as e:
            print(f"Treasury fetch warning ({ym}): {e}")
            continue

    raise RuntimeError("Could not fetch Treasury yield data after 3 attempts.")


def _parse_treasury_xml(xml_data, target_date):
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "d":    "http://schemas.microsoft.com/ado/2007/08/dataservices",
        "m":    "http://schemas.microsoft.com/ado/2007/08/dataservices/metadata",
    }
    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError:
        return None

    entries   = root.findall(".//atom:entry", ns)
    best_entry, best_date = None, None

    for entry in entries:
        props   = entry.find(".//m:properties", ns)
        if props is None:
            continue
        date_el = props.find("d:NEW_DATE", ns)
        if date_el is None or not date_el.text:
            continue
        entry_date = date.fromisoformat(date_el.text[:10])
        if entry_date <= target_date:
            if best_date is None or entry_date > best_date:
                best_date, best_entry = entry_date, props

    if best_entry is None:
        return None

    yields = {}
    for field, tenor in TREASURY_FIELDS.items():
        el = best_entry.find(f"d:{field}", ns)
        if el is not None and el.text:
            try:
                yields[tenor] = float(el.text)
            except ValueError:
                pass

    return {"date": best_date.isoformat(), "yields": dict(sorted(yields.items()))} if yields else None


# ── FRED ──────────────────────────────────────────────────────────────────────

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

FRED_TENOR_MAP = {
    "DGS1MO": 0.083, "DGS3MO": 0.25,  "DGS6MO": 0.5,
    "DGS1":   1.0,   "DGS2":   2.0,   "DGS5":   5.0,
    "DGS7":   7.0,   "DGS10":  10.0,  "DGS20":  20.0,  "DGS30": 30.0,
}


def fetch_fred_series(series_ids, years=5, api_key=None):
    """
    Fetch historical observations from FRED.

    Returns:
        {series_id: [(date_str, value_float), ...]}
    """
    start_date = (date.today() - timedelta(days=365 * years)).isoformat()
    results    = {}

    for sid in series_ids:
        params = {"series_id": sid, "observation_start": start_date, "file_type": "json"}
        if api_key:
            params["api_key"] = api_key
        url = FRED_BASE + "?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            results[sid] = [
                (obs["date"], float(obs["value"]))
                for obs in data.get("observations", [])
                if obs["value"] != "."
            ]
        except Exception as e:
            print(f"FRED fetch warning ({sid}): {e}")
            results[sid] = []

    return results


def fetch_historical_curve(years=5, api_key=None):
    """
    Fetch full historical yield curve matrix from FRED for PCA.

    Returns:
        {
            "dates":  [...],
            "tenors": [0.083, 0.25, 0.5, 1.0, 2.0, 5.0, 7.0, 10.0, 20.0, 30.0],
            "matrix": [[yields per tenor per date], ...]   shape: (n_dates, n_tenors)
        }
    """
    curve_series = ["DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2",
                    "DGS5", "DGS7", "DGS10", "DGS20", "DGS30"]
    tenors = [FRED_TENOR_MAP[s] for s in curve_series]
    raw    = fetch_fred_series(curve_series, years=years, api_key=api_key)

    by_date = {}
    for sid, obs in raw.items():
        for dt, val in obs:
            by_date.setdefault(dt, {})[sid] = val

    complete_dates = sorted(
        dt for dt, row in by_date.items()
        if all(s in row for s in curve_series)
    )
    matrix = [[by_date[dt][s] for s in curve_series] for dt in complete_dates]

    return {"dates": complete_dates, "tenors": tenors, "matrix": matrix}


def yields_to_bootstrap_input(treasury_data):
    """Convert Treasury dict -> sorted [(tenor, par_yield%), ...] for bootstrapper."""
    return sorted(treasury_data["yields"].items())


if __name__ == "__main__":
    print("Fetching latest Treasury par yields...")
    data = fetch_treasury_yields()
    print(f"\nDate: {data['date']}")
    print(f"{'Tenor':>8}  {'Par Yield':>10}")
    print("-" * 22)
    for tenor, y in data["yields"].items():
        label = f"{tenor}Y" if tenor >= 1 else f"{int(tenor*12)}M"
        print(f"{label:>8}  {y:>9.3f}%")
