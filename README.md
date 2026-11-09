# Yield Curve Suite

A Python library and interactive dashboard for yield curve modeling and analysis. Bootstraps spot rates from live US Treasury data, fits parametric models, and runs PCA decomposition of historical curve moves.

## Live Demo

[yield-curve-ebon.vercel.app](https://yield-curve-ebon.vercel.app)

**Bootstrapper** — fetches the latest par yields from the US Treasury, extracts zero-coupon spot rates so that every par bond reprices exactly at 100 (spot rates between quoted tenors are interpolated and solved numerically), and computes the implied forward curve. Charts par, spot, and forward curves side by side.

**Nelson-Siegel** — auto-fits the Nelson & Siegel (1987) parametric model to the bootstrapped spot curve via OLS grid search on λ. Interactive sliders let you adjust β₀, β₁, β₂, and λ in real time and observe how each parameter shapes the curve.

**PCA** — eigendecomposition of the covariance matrix of daily changes in US Treasury par yields over the last two years (12 tenors, 1M to 30Y), extracting the first three principal components. PC1 (level), PC2 (slope), and PC3 (curvature) loading vectors are displayed as interactive bar charts with factor interpretations. The PCA is computed in Python by `data/build_pca.py` and served to the dashboard as `public/pca.json`.

**Vasicek / CIR** — Monte Carlo simulation of Vasicek (1977) short-rate paths, with r₀ set from the live 1Y spot rate. Parameters κ, θ, σ, r₀ are adjustable in real time. A Feller condition check shows whether the CIR (1985) model would keep rates strictly positive (2κθ > σ²). CIR pricing and simulation are in the Python library.

## Python Library

```
src/
  bootstrapper.py        # spot rate extraction, forward rates, interpolation
  nelson_siegel.py       # NS fitting: OLS for the betas, grid search on λ
  pca.py                 # Jacobi eigendecomposition, loading vectors, factor scores
  vasicek.py             # Vasicek/CIR SDEs, Monte Carlo, Ito's Lemma, calibration
data/
  fetch.py               # US Treasury XML (latest day + history) and FRED fetchers (pure stdlib)
  build_pca.py           # PCA of Treasury history -> public/pca.json for the dashboard
examples/
  curve_basics.py        # forward rates, live Treasury snapshot
  bootstrapping.py       # par -> spot bootstrapping, pricing off the spot curve
  vasicek_cir.py         # Vasicek Monte Carlo, Ito's Lemma, CIR vs Vasicek
  nelson_siegel_pca.py   # NS fitting, PCA factors, full pipeline
```

## Live Data

The dashboard fetches the latest par yields directly from the US Treasury XML feed on page load and bootstraps them in the browser. If the request fails, it falls back to representative stub data and shows a warning. To check the latest curve from Python:

```bash
python data/fetch.py
```

To refresh the PCA with the latest two years of Treasury history:

```bash
python data/build_pca.py     # writes public/pca.json
git add public/pca.json
git commit -m "data: refresh PCA"
git push
```

## Setup

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

Python library (no external dependencies), run from the repository root:
```bash
python examples/curve_basics.py
python examples/bootstrapping.py
python examples/vasicek_cir.py
python examples/nelson_siegel_pca.py
```

## Related Projects

- [Bond Analytics](https://github.com/aharode/bond-analytics) — bond pricing, duration, convexity
- [Macro Dashboard](https://github.com/aharode/macro-dashboard) — FRED data, carry/roll strategy, backtester
