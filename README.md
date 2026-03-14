# Yield Curve Suite

A Python library and interactive dashboard for yield curve modeling and analysis. Bootstraps spot rates from live US Treasury data, fits parametric models, and runs PCA decomposition of historical curve moves.

## Live Demo

[yield-curve.vercel.app](https://yield-curve.vercel.app)

## Features

**Bootstrapper** — fetches today's par yields from the US Treasury, recursively extracts zero-coupon spot rates using no-arbitrage conditions, and computes the implied forward curve. Charts par, spot, and forward curves side by side.

**Nelson-Siegel** — auto-fits the Nelson & Siegel (1987) parametric model to the bootstrapped spot curve via OLS grid search on λ. Interactive sliders let you adjust β₀, β₁, β₂, and λ in real time and observe how each parameter shapes the curve.

**PCA** — runs eigendecomposition of a historical daily yield change covariance matrix, extracting the first three principal components. PC1 (level), PC2 (slope), and PC3 (curvature) loading vectors are displayed as interactive bar charts with factor interpretations.

**Vasicek / CIR** — Monte Carlo simulation of the Vasicek (1977) and CIR (1985) short-rate models. Parameters κ, θ, σ, r₀ are adjustable in real time. Feller condition box turns amber when 2κθ < σ², indicating negative rates are possible.

## Python Library

```
src/
  bootstrapper.py    # spot rate extraction, forward rates, interpolation
  nelson_siegel.py   # NS fitting via OLS grid search on λ
  pca.py             # Jacobi eigendecomposition, loading vectors, factor scores
  vasicek.py         # Vasicek/CIR SDEs, Monte Carlo, Ito's Lemma, calibration
data/
  fetch.py           # US Treasury XML + FRED API fetchers (pure stdlib)
problems/
  day4_problems.py   # yield curve basics, forward rate derivations
  day5_problems.py   # bootstrapping from par yields
  day6_problems.py   # Vasicek Monte Carlo, Ito's Lemma, CIR vs Vasicek
  day7_problems.py   # NS fitting, PCA decomposition, Week 1 synthesis
```

## Live Data

The UI fetches par yields directly from the US Treasury XML feed on page load and runs the bootstrap algorithm in the browser. If the Treasury server blocks the request (CORS), the app falls back to representative stub data and displays a warning.

To refresh with guaranteed live data, run the Python fetcher locally and commit the output:

```bash
python data/fetch.py
# writes public/curve_data.json
git add public/curve_data.json
git commit -m "data: refresh Treasury yields"
git push
```

## Setup

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

Python library (no external dependencies):
```bash
python problems/day4_problems.py
python problems/day5_problems.py
python problems/day6_problems.py
python problems/day7_problems.py
```

## Related Projects

- [Bond Analytics](https://github.com/aharode/bond-analytics) — Project 1: bond pricing, duration, convexity
- [Macro Dashboard](https://github.com/aharode/macro-dashboard) — Project 3: FRED data, carry/roll strategy, backtester
