"""
Term Structure Models II (Nelson-Siegel, PCA)
"""

import sys, math, random
sys.path.insert(0, ".")

from src.nelson_siegel import fit_ns, ns_yield, interpret_params, ns_loadings, extrapolate
from src.pca import run_pca, loading_table, factor_interpretation, portfolio_pca_risk
from src.bootstrapper import bootstrap_spot_rates, spot_to_forward


def sep(title):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print('─'*60)


# ── Problem 1 ─────────────────────────────────────────────────────────────────
sep("Problem 1 — Fit NS to an example curve")

# Example curve
tenors     = [0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
yields_pct = [5.3,  5.2, 4.9, 4.6, 4.4,  4.5,  4.7]

result = fit_ns(tenors, yields_pct)

print(f"Input curve: {list(zip(tenors, yields_pct))}")
print(f"\nFitted parameters:")
print(f"  β₀ = {result['beta0']:.4f}%  → long-run level")
print(f"  β₁ = {result['beta1']:.4f}%  → slope (β₀+β₁ = short rate = {result['beta0']+result['beta1']:.4f}%)")
print(f"  β₂ = {result['beta2']:.4f}%  → curvature")
print(f"  λ  = {result['lambda']:.4f}Y → hump peaks here")
print(f"  RMSE = {result['rmse_bp']:.4f} bp")

interp = interpret_params(result['beta0'], result['beta1'],
                           result['beta2'], result['lambda'])
print(f"\nCurve interpretation:")
print(f"  Short rate (τ→0):  {interp['short_rate_pct']:.4f}%")
print(f"  Long rate  (τ→∞):  {interp['long_rate_pct']:.4f}%")
print(f"  Slope:             {interp['slope_bp']:+.1f} bp  [{interp['curve_shape']}]")
print(f"  Belly shape:       {interp['belly_shape']}")

print(f"\nReasoning through the parameters manually:")
print(f"  β₀ ≈ {result['beta0']:.2f}% because 30Y yield ≈ long-run level")
print(f"  β₁ ≈ {result['beta1']:.2f}% because short rate - long rate = {yields_pct[0]-result['beta0']:.2f}%")
print(f"  β₂ drives the inversion hump visible at the short end")
print(f"  λ ≈ {result['lambda']:.2f}Y: hump/trough around 2Y (where curve turns)")


# ── Problem 2 ─────────────────────────────────────────────────────────────────
sep("Problem 2 — PC1 level shift: DV01 impact on 10Y long / 2Y short")

# Approximate durations
DUR_10Y = 8.5
DUR_2Y  = 1.9
FACE    = 10_000_000  # $10M

# DV01 = Duration × Price × 0.0001 (per $100 face, price ≈ 100)
dv01_10y = DUR_10Y * FACE / 10000  # per bp
dv01_2y  = DUR_2Y  * FACE / 10000

print(f"Portfolio: long $10M 10Y, short $10M 2Y")
print(f"  DV01 10Y long:  +${dv01_10y:,.0f}/bp")
print(f"  DV01 2Y short:  -${dv01_2y:,.0f}/bp")
print(f"  Net DV01:        ${dv01_10y - dv01_2y:,.0f}/bp")
print()

# PC1 = 50bp parallel shift
shift_bp = 50
pnl_10y  = -dv01_10y * shift_bp   # long 10Y loses when rates rise
pnl_2y   =  dv01_2y  * shift_bp   # short 2Y gains when rates rise
net_pnl  = pnl_10y + pnl_2y

print(f"PC1 rises 1 unit (50bp parallel shift up):")
print(f"  10Y long P&L:  ${pnl_10y:>+12,.0f}  (duration {DUR_10Y}Y × -50bp)")
print(f"  2Y short P&L:  ${pnl_2y:>+12,.0f}  (short position gains)")
print(f"  Net P&L:       ${net_pnl:>+12,.0f}")
print()
print(f"Insight: net DV01 = ${dv01_10y-dv01_2y:,.0f}/bp — this is a PC1 (level) trade.")
print(f"The portfolio is net long duration, so it loses on a parallel rate rise.")


# ── Problem 3 ─────────────────────────────────────────────────────────────────
sep("Problem 3 — Running a PC2 trade (slope / steepener/flattener)")

print("A PM running a 'PC2 trade' is expressing a view on curve slope.")
print()
print("PC2 = slope factor: short end and long end move in opposite directions.")
print()
print("If she's LONG PC2 (steepener):")
print("  → Expects 2s10s spread to WIDEN (curve steepens)")
print("  → Short the 2Y (short rates rise more) + Long the 10Y (long rates fall/rise less)")
print("  → Position: RECEIVE fixed on 2Y swap + PAY fixed on 10Y swap")
print("             or: Short 2Y Treasuries + Long 10Y Treasuries")
print()
print("If she's SHORT PC2 (flattener):")
print("  → Expects 2s10s spread to NARROW (curve flattens/inverts)")
print("  → Long the 2Y + Short the 10Y")
print()
print("DV01-neutral steepener sizing:")
print(f"  DV01 2Y = {DUR_2Y:.1f} × $10M / 10000 = ${DUR_2Y * 10e6/10000:,.0f}/bp")
print(f"  DV01 10Y = {DUR_10Y:.1f} × $10M / 10000 = ${DUR_10Y * 10e6/10000:,.0f}/bp")
ratio = DUR_10Y / DUR_2Y
print(f"  To hedge: need {ratio:.2f}x more 2Y notional per unit of 10Y")
print(f"  e.g. long $10M 10Y + short ${ratio*10:.0f}M 2Y → DV01 neutral on PC1")
print(f"  This isolates the PC2 (slope) exposure")


# ── Problem 4 ─────────────────────────────────────────────────────────────────
sep("Problem 4 — Butterfly trade as a PC3 trade")

print("The butterfly trade: long 5Y belly, short 2Y and 10Y wings")
print()
print("PC3 = curvature factor: belly moves relative to wings")
print("  PC3 loading: negative at short end, positive in belly, negative at long end")
print("  (or vice versa depending on sign convention)")
print()
print("LONG butterfly (long belly, short wings):")
print("  → Profits when 5Y yield falls relative to 2Y and 10Y")
print("  → Curvature INCREASES (curve becomes more humped)")
print()
print("Why it's called PC3:")
print("  PC1 = level shift = duration trade")
print("  PC2 = slope shift = steepener/flattener")
print("  PC3 = curvature shift = butterfly")
print()
print("DV01-neutral butterfly sizing (per $10M 5Y):")
# Approximate durations
dur_2y, dur_5y, dur_10y = 1.9, 4.5, 8.5
notional_5y = 10_000_000
dv01_5y_pos = dur_5y * notional_5y / 10000
# Split wings 50/50 for simplicity, DV01 neutral
dv01_per_wing = dv01_5y_pos / 2
n_2y  = dv01_per_wing / (dur_2y / 10000)
n_10y = dv01_per_wing / (dur_10y / 10000)
print(f"  Long ${notional_5y/1e6:.0f}M 5Y   DV01: +${dv01_5y_pos:,.0f}/bp")
print(f"  Short ${n_2y/1e6:.1f}M 2Y   DV01: -${dv01_per_wing:,.0f}/bp")
print(f"  Short ${n_10y/1e6:.1f}M 10Y  DV01: -${dv01_per_wing:,.0f}/bp")
print(f"  Net DV01: $0  (PC1 and PC2 neutral, pure PC3 exposure)")


# ── Problem 5 ─────────────────────────────────────────────────────────────────
sep("Problem 5 — Full pipeline: par → spot → forward → NS → PCA")

print("Full chain of steps, from par yields to PCA:")
print()

# Step A: bootstrap spot curve from par yields
par_yields = [(0.5, 5.3), (1.0, 5.1), (1.5, 4.95), (2.0, 4.8)]
spots = bootstrap_spot_rates(par_yields)
print("(A) EXTRACT SPOT CURVE from par yields [bootstrapper.py]:")
print(f"    Input par yields: {par_yields}")
print(f"    Bootstrapped spots:")
for t, s in spots:
    print(f"      {t}Y: {s:.4f}%")

# Step B: compute forward rates
fwds = spot_to_forward(spots)
print(f"\n(B) COMPUTE FORWARD RATES from spot curve [bootstrapper.py]:")
for t, f in fwds:
    print(f"      {t}Y: {f:.4f}%")
print(f"    Interpretation: forward curve shows implied future short-term rates")

# Step C: fit Nelson-Siegel
t_list = [t for t, _ in spots]
y_list = [s for _, s in spots]
ns = fit_ns(t_list, y_list)
print(f"\n(C) FIT NELSON-SIEGEL [nelson_siegel.py]:")
print(f"    β₀={ns['beta0']:.4f}%, β₁={ns['beta1']:.4f}%, β₂={ns['beta2']:.4f}%, λ={ns['lambda']:.4f}Y")
print(f"    RMSE={ns['rmse_bp']:.4f}bp")
print(f"    Use: smoothly interpolate/extrapolate any tenor; central bank standard")

# Step D: PCA
print(f"\n(D) RUN PCA on historical yield changes [pca.py]:")
print(f"    Input: daily Δyields matrix from Treasury history (T days × M tenors)")
print(f"    Output: eigendecomposition of covariance matrix Σ = V·Λ·Vᵀ")
print(f"    PC1 (~85%): level — parallel shifts (Fed policy)")
print(f"    PC2 (~10%): slope — steepener/flattener (curve shape)")
print(f"    PC3 (~3%):  curvature — butterfly (belly vs wings)")
print(f"    Use: risk decomposition, hedge ratios, trade structuring")

print(f"\nSummary of practical uses:")
print(f"  Spot curve  → discount any fixed cash flow at its exact maturity rate")
print(f"  Forwards    → carry & roll calculations; breakeven analysis")
print(f"  NS model    → smooth curve for derivative pricing; central bank reporting")
print(f"  PCA         → risk attribution; factor-based hedging; trade identification")
