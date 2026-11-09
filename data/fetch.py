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

import urllib.error
import urllib.request
import urllib.parse
import json
import time
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


# The Treasury site can stall requests that carry Python's default user agent,
# so requests send a generic browser-style one and retry with backoff.
HTTP_HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/xml,text/xml,*/*"}


def _http_get(url, timeout=30, retries=4):
    """GET a URL as text, retrying on timeouts and connection errors."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HTTP_HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8")
        except (TimeoutError, urllib.error.URLError) as e:
            if attempt == retries - 1:
                raise RuntimeError(f"Request failed after {retries} attempts: {url}") from e
            wait = 2 ** attempt
            print(f"  retrying in {wait}s ({type(e).__name__})")
            time.sleep(wait)


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
            xml_data = _http_get(url)
            result = _parse_treasury_xml(xml_data, target_date)
            if result:
                return result
        except Exception as e:
            print(f"Treasury fetch warning ({ym}): {e}")
            continue

    raise RuntimeError("Could not fetch Treasury yield data after 3 attempts.")


def _parse_treasury_entries(xml_data):
    """Parse every daily entry in a Treasury XML month.

    Returns a list of (date, {tenor: par_yield_pct}) sorted by date.
    Returns None if the XML cannot be parsed.
    """
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "d":    "http://schemas.microsoft.com/ado/2007/08/dataservices",
        "m":    "http://schemas.microsoft.com/ado/2007/08/dataservices/metadata",
    }
    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError:
        return None

    rows = []
    for entry in root.findall(".//atom:entry", ns):
        props = entry.find(".//m:properties", ns)
        if props is None:
            continue
        date_el = props.find("d:NEW_DATE", ns)
        if date_el is None or not date_el.text:
            continue
        yields = {}
        for field, tenor in TREASURY_FIELDS.items():
            el = props.find(f"d:{field}", ns)
            if el is not None and el.text:
                try:
                    yields[tenor] = float(el.text)
                except ValueError:
                    pass
        if yields:
            rows.append((date.fromisoformat(date_el.text[:10]), dict(sorted(yields.items()))))
    return sorted(rows, key=lambda r: r[0])


def _parse_treasury_xml(xml_data, target_date):
    """Latest entry on or before target_date, as {"date", "yields"}; None if none."""
    rows = _parse_treasury_entries(xml_data)
    if not rows:
        return None
    eligible = [r for r in rows if r[0] <= target_date]
    if not eligible:
        return None
    best_date, yields = eligible[-1]
    return {"date": best_date.isoformat(), "yields": yields}


def fetch_treasury_history(years=2, end=None):
    """
    Daily par yields from the US Treasury XML feed over the last `years` years.
    Makes one request per calendar month.

    Only dates with a yield at every tenor in TREASURY_FIELDS are kept, so the
    matrix has no gaps.

    Returns:
        {
            "dates":   ["2024-11-11", ...],
            "tenors":  [0.083, 0.167, ..., 30.0],
            "matrix":  [[yield % per tenor], ...]     shape: (n_dates, n_tenors)
            "dropped": number of dates skipped for missing tenors,
        }
    """
    if end is None:
        end = date.today()
    elif isinstance(end, str):
        end = date.fromisoformat(end)
    start = end - timedelta(days=round(365.25 * years))

    rows = {}
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        ym = f"{year}{month:02d}"
        print(f"  {ym}", flush=True)
        parsed = _parse_treasury_entries(_http_get(TREASURY_URL.format(ym=ym)))
        if parsed is None:
            raise RuntimeError(f"Could not parse Treasury XML for {ym}")
        for d, yields in parsed:
            if start <= d <= end:
                rows[d] = yields
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)

    tenors = sorted(TREASURY_FIELDS.values())
    dates  = sorted(d for d, y in rows.items() if all(t in y for t in tenors))
    return {
        "dates":   [d.isoformat() for d in dates],
        "tenors":  tenors,
        "matrix":  [[rows[d][t] for t in tenors] for d in dates],
        "dropped": len(rows) - len(dates),
    }


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
