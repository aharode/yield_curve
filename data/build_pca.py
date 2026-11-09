"""
data/build_pca.py

Builds public/pca.json for the dashboard's PCA tab: a PCA of daily changes in
US Treasury par yields over the last N years (default 2), using src/pca.py.

The dashboard loads this file instead of computing PCA in the browser, so the
loadings come from real market history. Rerun it to refresh the data:

    python data/build_pca.py            # last 2 years
    python data/build_pca.py --years 5
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from data.fetch import fetch_treasury_history  # noqa: E402
from src.pca import factor_interpretation, run_pca  # noqa: E402

OUTPUT = ROOT / "public" / "pca.json"


def build_pca_payload(history, n_components=3):
    """PCA summary for the UI from a fetch_treasury_history() result."""
    result = run_pca(history["dates"], history["tenors"], history["matrix"], n_components)
    return {
        "source":       "US Treasury daily par yield curve",
        "method":       "PCA of daily yield changes (covariance, percentage points)",
        "start":        history["dates"][0],
        "end":          history["dates"][-1],
        "n_obs":        result["n_obs"],
        "tenors":       result["tenors"],
        "variance_pct": result["variance_pct"],
        "cum_variance": result["cum_variance"],
        "loadings":     result["loadings"],
        "labels":       factor_interpretation(result),
        "generated":    date.today().isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--years", type=float, default=2.0)
    args = parser.parse_args()

    print(f"Fetching {args.years:g} years of Treasury par yields...")
    history = fetch_treasury_history(years=args.years)
    print(f"  {len(history['dates'])} complete days, {history['dropped']} dropped for missing tenors")

    payload = build_pca_payload(history)
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=1))

    print(f"\nPCA {payload['start']} to {payload['end']} ({payload['n_obs']} daily changes)")
    for k, (v, label) in enumerate(zip(payload["variance_pct"], payload["labels"])):
        print(f"  PC{k + 1}: {v:5.1f}%  {label}")
    print(f"\nWrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
