"""
Term Structure Models I (Vasicek & CIR)
"""

import sys
sys.path.insert(0, ".")
from src.vasicek import (
    simulate_vasicek, simulate_cir,
    vasicek_expected_rate, vasicek_variance,
    vasicek_bond_price, vasicek_yield,
    feller_condition, itos_lemma_demo,
    calibrate_vasicek_moments,
)
import math


def separator(title):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print('─'*60)


# Example parameters
KAPPA = 0.3
THETA = 0.05
SIGMA = 0.02
R0    = 0.03
DT    = 1/12   # monthly steps


# ── Problem 1 ─────────────────────────────────────────────────────────────────
separator("Problem 1 — Vasicek Monte Carlo: pseudocode + first path")

print("Algorithm:")
print("  1. Initialise r = r₀")
print("  2. For each time step t = 1..N:")
print("        Z ~ N(0,1)")
print("        r ← r + κ(θ - r)·Δt + σ·√Δt·Z")
print("        store r")
print("  3. Repeat for n_paths paths")
print()

# Simulate one path with fixed Z draws so the arithmetic can be checked by hand
Z_VALS = [0.5, -0.3, 1.1, -0.8, 0.2, -0.1, 0.9, -0.5, 0.3, -0.2, 0.7, -0.4]
r = R0
print(f"{'Month':>5}  {'r_prev':>8}  {'Z':>6}  {'dr':>9}  {'r_new':>8}")
print("-" * 46)
path = [r]
for i, z in enumerate(Z_VALS):
    dr    = KAPPA * (THETA - r) * DT + SIGMA * math.sqrt(DT) * z
    r_new = r + dr
    print(f"{i+1:>5}  {r*100:>7.4f}%  {z:>6.2f}  {dr*100:>8.5f}%  {r_new*100:>7.4f}%")
    path.append(r_new)
    r = r_new

print(f"\nFinal rate after 12 months: {r*100:.4f}%")
print(f"Long-run mean θ:            {THETA*100:.2f}%")
print(f"Rate is {'above' if r > THETA else 'below'} θ — mean reversion pulling it {'down' if r > THETA else 'up'}")


# ── Problem 2 ─────────────────────────────────────────────────────────────────
separator("Problem 2 — Monte Carlo path simulation (500 paths)")

sim = simulate_vasicek(R0, KAPPA, THETA, SIGMA, T=1.0, dt=DT, n_paths=500, seed=42)
print(f"Simulated {len(sim['paths'])} paths over 1 year (monthly steps)")
print(f"\nCross-sectional stats at t=1Y (month 12):")

final_rates = [p[-1] for p in sim["paths"]]
final_rates.sort()
n = len(final_rates)
mean_sim  = sum(final_rates) / n
var_sim   = sum((r - mean_sim)**2 for r in final_rates) / n
std_sim   = math.sqrt(var_sim)
p5        = final_rates[int(0.05 * n)]
p95       = final_rates[int(0.95 * n)]
mean_an   = vasicek_expected_rate(R0, KAPPA, THETA, 1.0)
var_an    = vasicek_variance(KAPPA, SIGMA, 1.0)

print(f"  Simulated mean:    {mean_sim*100:.4f}%")
print(f"  Analytical E[r₁]:  {mean_an*100:.4f}%   ← should match")
print(f"  Simulated std:     {std_sim*100:.4f}%")
print(f"  Analytical std:    {math.sqrt(var_an)*100:.4f}%   ← should match")
print(f"  5th percentile:    {p5*100:.4f}%")
print(f"  95th percentile:   {p95*100:.4f}%")


# ── Problem 3 ─────────────────────────────────────────────────────────────────
separator("Problem 3 — E[r_t] = θ + (r₀ - θ)e^(-κt) as t→∞")

print(f"Parameters: κ={KAPPA}, θ={THETA*100}%, σ={SIGMA*100}%, r₀={R0*100}%")
print()
print(f"{'t (years)':>10}  {'E[r_t]':>10}  {'Δ from θ':>12}")
print("-" * 38)
for t in [0, 0.5, 1, 2, 5, 10, 20, 50]:
    e_rt  = vasicek_expected_rate(R0, KAPPA, THETA, t)
    delta = e_rt - THETA
    print(f"{t:>10}  {e_rt*100:>9.5f}%  {delta*100:>+11.5f}%")

print(f"\nAs t→∞, E[r_t] → θ = {THETA*100}%  (mean reversion)")
print(f"Half-life of reversion: ln(2)/κ = {math.log(2)/KAPPA:.2f} years")


# ── Problem 4 ─────────────────────────────────────────────────────────────────
separator("Problem 4 — Ito's Lemma: d(e^(κt)·r) has no r on RHS")

demo = itos_lemma_demo(KAPPA, THETA, SIGMA, R0)
print("Applying Ito's Lemma to f(r,t) = e^(κt) · r:")
print()
for key, val in demo.items():
    label = key.replace("_", " ").capitalize()
    print(f"  {label:25s}: {val}")

print()
print("Key insight: the r(t) term cancels in df, leaving only constants.")
print("This makes the SDE analytically integrable — the r₀·e^(-κt) + θ(1-e^(-κt))")
print("solution follows directly by integrating both sides.")


# ── Problem 5 ─────────────────────────────────────────────────────────────────
separator("Problem 5 — CIR vs Vasicek when r₀ = 0.5%")

r_low = 0.005  # 0.5%
print(f"Today's rate r₀ = {r_low*100}%")
print()

# Feller check
ok, lhs, rhs = feller_condition(KAPPA, THETA, SIGMA)
print(f"Feller condition: 2κθ = {lhs:.4f} > σ² = {rhs:.4f}? {ok}")
print()

# Vasicek bond price vs CIR at low rates
from src.vasicek import cir_bond_price, cir_yield
print(f"{'Tenor':>6}  {'Vasicek P':>12}  {'Vasicek y%':>12}  {'CIR P':>10}  {'CIR y%':>10}")
print("-" * 58)
for tau in [1, 2, 5, 10, 30]:
    pv = vasicek_bond_price(r_low, KAPPA, THETA, SIGMA, tau)
    yv = vasicek_yield(r_low, KAPPA, THETA, SIGMA, tau) * 100
    pc = cir_bond_price(r_low, KAPPA, THETA, SIGMA, tau)
    yc = cir_yield(r_low, KAPPA, THETA, SIGMA, tau) * 100
    print(f"{tau:>5}Y  {pv:>12.6f}  {yv:>11.4f}%  {pc:>10.6f}  {yc:>9.4f}%")

print()
print("At r₀ = 0.5%, CIR is more appropriate because:")
print("  • Vasicek σ√dt noise can push r negative (no economic meaning)")
print("  • CIR σ√r·dW → 0 as r → 0, creating a 'soft floor'")
print("  • When Feller holds (2κθ > σ²), CIR guarantees r > 0 always")
print()

# Simulate and count negative paths
sim_v = simulate_vasicek(r_low, KAPPA, THETA, SIGMA, T=5.0, dt=DT, n_paths=1000, seed=42)
neg_paths = sum(1 for p in sim_v["paths"] if any(r < 0 for r in p))
print(f"Vasicek: {neg_paths}/1000 paths go negative over 5Y at r₀={r_low*100}%")

sim_c = simulate_cir(r_low, KAPPA, THETA, SIGMA, T=5.0, dt=DT, n_paths=1000, seed=42)
neg_cir = sum(1 for p in sim_c["paths"] if any(r < 0 for r in p))
print(f"CIR:     {neg_cir}/1000 paths go negative over 5Y at r₀={r_low*100}%")
