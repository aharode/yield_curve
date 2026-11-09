"""
Yield Curve Basics.
"""

import sys
sys.path.insert(0, ".")
from src.bootstrapper import forward_rate, bootstrap_spot_rates, curve_summary


def separator(title):
    print(f"\n{'─'*55}")
    print(f"  {title}")
    print('─'*55)


# ── Problem 1 ─────────────────────────────────────────────────────────────────
separator("Problem 1 — Forward rates from spot rates")
# Given: 1Y spot = 3%, 2Y spot = 4%, 3Y spot = 4.5%
s1, s2, s3 = 3.0, 4.0, 4.5

f_1_2 = forward_rate(s1_pct=s1, T1=1, s2_pct=s2, T2=2)
f_2_3 = forward_rate(s1_pct=s2, T1=2, s2_pct=s3, T2=3)

print(f"1Y spot = {s1}%, 2Y spot = {s2}%, 3Y spot = {s3}%")
print(f"f(1,2) = {f_1_2:.4f}%   [1Y forward rate, 1Y from now]")
print(f"f(2,3) = {f_2_3:.4f}%   [1Y forward rate, 2Y from now]")
print()
print("Manual check f(1,2):")
print(f"  (1 + s2/2)^2 / (1 + s1/2)^2 - 1 (annual approx)")
import math
manual = ((1 + s2/200)**2 / (1 + s1/200)**2 - 1) * 2 * 100
print(f"  = {manual:.4f}% (semi-annual conv)")


# ── Problem 2 ─────────────────────────────────────────────────────────────────
separator("Problem 2 — Implied 2Y spot from 1Y spot + 1Y/1Y forward")
# 1Y spot = 3%, 1Y/1Y forward = 5% → implied 2Y spot?
s1_pct = 3.0
f12_pct = 5.0
# (1 + s2/2)^2 = (1 + s1/2)^1 * ... wait — using annual compounding for simplicity:
# (1+s2)^2 = (1+s1) * (1+f12)  => s2 = sqrt((1+s1)(1+f12)) - 1
s2_implied = (math.sqrt((1 + s1_pct/100) * (1 + f12_pct/100)) - 1) * 100
print(f"1Y spot = {s1_pct}%, 1Y/1Y forward = {f12_pct}%")
print(f"Implied 2Y spot = {s2_implied:.4f}%  (annual compounding)")
# Semi-annual version
s2_sa = (((1 + s1_pct/200)**2 * (1 + f12_pct/200)**2) ** (1/4) - 1) * 200
print(f"Implied 2Y spot = {s2_sa:.4f}%  (semi-annual compounding)")


# ── Problem 3 ─────────────────────────────────────────────────────────────────
separator("Problem 3 — f(2,5): 3Y forward rate starting in 2Y")
s2_pct = 4.0
s5_pct = 5.0
f_2_5 = forward_rate(s1_pct=s2_pct, T1=2, s2_pct=s5_pct, T2=5)
print(f"2Y spot = {s2_pct}%, 5Y spot = {s5_pct}%")
print(f"f(2,5) = {f_2_5:.4f}%")
print("Economic meaning: the market-implied 3Y rate starting 2Y from now.")
print("If you think rates will be LOWER than this, you are bullish the 2s5s forward.")


# ── Problem 4 ─────────────────────────────────────────────────────────────────
separator("Problem 4 — Live Treasury yields")
try:
    from data.fetch import fetch_treasury_yields
    live = fetch_treasury_yields()
    y = live["yields"]
    print(f"US Treasury par yields as of {live['date']}:")
    for tenor in (2.0, 5.0, 10.0, 30.0):
        if tenor in y:
            print(f"  {tenor:g}Y: {y[tenor]:.2f}%")
    if 2.0 in y and 10.0 in y:
        print(f"  2s10s spread: {(y[10.0] - y[2.0]) * 100:+.0f} bp")
except Exception as e:
    print(f"Could not fetch live Treasury yields ({e}); run data/fetch.py when online.")


# ── Problem 5 ─────────────────────────────────────────────────────────────────
separator("Problem 5 — Forward rates above spot rates ↔ upward-sloping curve")
# If forwards > spots, the spot curve must be upward sloping.
# Proof by example:
par_example = [(0.5, 3.0), (1.0, 3.5), (2.0, 4.0), (3.0, 4.3), (5.0, 4.5)]
result = curve_summary(par_example)

print("Par yields:    " + "  ".join(f"{t}Y={p}%" for t, p in par_example))
print()
print(f"{'Tenor':>6}  {'Spot':>8}  {'Forward':>10}  {'Fwd > Spot?':>12}")
print("-" * 44)
spot_d   = dict(result["spots"])
fwd_d    = dict(result["forwards"])
for t in sorted(spot_d.keys()):
    s = spot_d[t]
    f = fwd_d.get(t, 0)
    flag = "✓ yes" if f > s else "✗ no (first point)"
    print(f"{t:>5}Y  {s:>7.4f}%  {f:>9.4f}%  {flag:>12}")

print()
print("Conclusion: when fwd > spot at every tenor, spot curve is upward sloping.")
print("The forward rate is 'above' the spot because it prices in rising rates ahead.")
