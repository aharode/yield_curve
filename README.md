# Yield Curve Suite

Tools to bootstrap spot and forward curves from US Treasury data, fit parametric models, and decompose historical curve moves into level, slope, and curvature factors.

**Live demo → [yield-curve.vercel.app](https://yield-curve.vercel.app)**

---

## What it does

| Tab | What it shows |
|---|---|
| **Bootstrapper** | Par · spot · forward curves extracted recursively from on-the-run Treasuries |
| **Nelson-Siegel** | Parametric curve fitting with interactive parameter exploration |
| **PCA** | Level / slope / curvature decomposition of historical yield curve moves |
| **Vasicek / CIR** | Mean-reverting short rate model with live Monte Carlo simulation |

---

## Project structure

```
yield_curve/
├── src/                    ← Python library
│   ├── bootstrapper.py     ← Days 4–5: recursive spot rate extraction
│   ├── nelson_siegel.py    ← Day 7: NS parametric fitting (scipy.optimize)
│   ├── pca.py              ← Day 7: PCA on historical yield changes
│   └── vasicek.py          ← Day 6: Vasicek / CIR Monte Carlo
│
├── data/
│   └── fetch.py            ← Treasury + FRED data fetchers
│
├── problems/               ← Study verification scripts
│
├── ui/
│   └── src/
│       └── App.jsx         ← React frontend (Vite + recharts)
│
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

---

## Data sources

- **US Treasury** — daily par yields for bootstrapping  
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/`
- **FRED API** — historical yield data for PCA and backtesting  
  `https://fred.stlouisfed.org/`

---

## Running locally

**React UI**
```bash
npm install
npm run dev
# → http://localhost:5173
```

**Python library**
```bash
pip install numpy scipy pandas requests
python problems/day4_problems.py
```

---

## Related projects

| Project | Description |
|---|---|
| **[Bond Analytics](https://github.com/aharode/bond-analytics)** | Pricing · Duration · Convexity |
| **Macro Dashboard** | FRED · Carry signals · Backtester · FOMC regimes |
