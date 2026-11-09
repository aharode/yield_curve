"""
data/build_dashboard_data.py

Builds the static data files the dashboard loads, from two years of daily
US Treasury par yields (one download, shared by both outputs):

    public/pca.json      PCA of daily yield changes (src/pca.py), plus
                         PCA-neutral steepener and butterfly trades
    public/vasicek.json  Vasicek parameters calibrated to the 3-month T-bill
                         yield (src/vasicek.py)

Rerun to refresh:

    python data/build_dashboard_data.py            # last 2 years
    python data/build_dashboard_data.py --years 5
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from data.fetch import fetch_treasury_history  # noqa: E402
from src.pca import factor_interpretation, factor_neutral_trade, run_pca  # noqa: E402
from src.vasicek import calibrate_vasicek_moments, feller_condition  # noqa: E402

PUBLIC = ROOT / "public"
SHORT_RATE_TENOR = 0.25      # 3-month T-bill as the short-rate proxy
TRADING_DAYS = 252

# Curve trades expressed with PCA hedge ratios
TRADES = [
    {"name": "2s10s steepener", "legs": [2.0, 10.0], "anchor": 2.0, "neutralize": [0],
     "note": "long 2Y / short 10Y, level-neutral: pure slope exposure"},
    {"name": "2s5s10s butterfly", "legs": [2.0, 5.0, 10.0], "anchor": 5.0, "neutralize": [0, 1],
     "note": "long 5Y belly / short wings, level- and slope-neutral: pure curvature exposure"},
]


def build_pca_payload(history, n_components=3):
    """PCA summary and PCA-neutral trades for the dashboard."""
    result = run_pca(history["dates"], history["tenors"], history["matrix"], n_components)
    trades = []
    for spec in TRADES:
        t = factor_neutral_trade(result["tenors"], result["loadings"], spec["legs"],
                                 spec["anchor"], spec["neutralize"])
        trades.append({
            "name":       spec["name"],
            "note":       spec["note"],
            "neutral_to": [f"PC{k + 1}" for k in spec["neutralize"]],
            "legs":       [{"tenor": tenor, "dv01": dv01} for tenor, dv01 in t["dv01"].items()],
            "exposures":  t["exposures"],
        })
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
        "trades":       trades,
        "generated":    date.today().isoformat(),
    }


def build_vasicek_payload(history):
    """Vasicek parameters calibrated to the daily 3-month T-bill yield."""
    col = history["tenors"].index(SHORT_RATE_TENOR)
    rates = [row[col] / 100 for row in history["matrix"]]
    cal = calibrate_vasicek_moments(rates, dt=1 / TRADING_DAYS)
    feller_ok = None
    if cal["kappa"] > 0 and cal["theta"] > 0:
        feller_ok, _, _ = feller_condition(cal["kappa"], cal["theta"], cal["sigma"])
    return {
        "source":          "US Treasury 3-month bill yield (bond-equivalent), daily",
        "method":          "OLS on the discretised SDE: r(t+Δt) = α + β·r(t) + ε, Δt = 1/252",
        "start":           history["dates"][0],
        "end":             history["dates"][-1],
        **cal,
        "mean_reverting":  cal["kappa"] > 0,
        "feller":          feller_ok,
        "r_last":          rates[-1],
        "generated":       date.today().isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--years", type=float, default=2.0)
    args = parser.parse_args()

    print(f"Fetching {args.years:g} years of Treasury par yields...")
    history = fetch_treasury_history(years=args.years)
    print(f"  {len(history['dates'])} complete days, {history['dropped']} dropped for missing tenors")
    PUBLIC.mkdir(exist_ok=True)

    pca = build_pca_payload(history)
    (PUBLIC / "pca.json").write_text(json.dumps(pca, indent=1))
    print(f"\nPCA {pca['start']} to {pca['end']} ({pca['n_obs']} daily changes)")
    for k, (v, label) in enumerate(zip(pca["variance_pct"], pca["labels"])):
        print(f"  PC{k + 1}: {v:5.1f}%  {label}")
    for t in pca["trades"]:
        legs = ", ".join(f"{leg['tenor']:g}Y {leg['dv01']:+,.0f}" for leg in t["legs"])
        print(f"  {t['name']} ({'/'.join(t['neutral_to'])}-neutral), DV01 $/bp: {legs}")

    vas = build_vasicek_payload(history)
    (PUBLIC / "vasicek.json").write_text(json.dumps(vas, indent=1))
    hl = f"{vas['half_life_years']:.2f}y" if vas["half_life_years"] else "n/a (no mean reversion)"
    print(f"\nVasicek on 3M bill: κ = {vas['kappa']:.3f} (se {vas['kappa_se']:.3f}), "
          f"θ = {vas['theta'] * 100:.2f}%, σ = {vas['sigma'] * 100:.2f}%, half-life {hl}")

    print("\nWrote public/pca.json and public/vasicek.json")


if __name__ == "__main__":
    main()
