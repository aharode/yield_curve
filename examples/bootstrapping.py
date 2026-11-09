"""
Bootstrapping the Spot Curve
"""

import sys
sys.path.insert(0, ".")
from src.bootstrapper import bootstrap_spot_rates, forward_rate, interpolate_curve, price_from_spot_curve


def separator(title):
    print(f"\n{'─'*55}")
    print(f"  {title}")
    print('─'*55)


# ── Problem 1 ─────────────────────────────────────────────────────────────────
separator("Problem 1 — 6M spot rate from T-bill price")
# 6M T-bill price = 97.56, face = 100
P_6m, F = 97.56, 100.0
s_6m = 2 * (F / P_6m - 1) * 100
print(f"6M T-bill: price = {P_6m}, face = {F}")
print(f"s_6m = 2 × (F/P - 1) = 2 × ({F}/{P_6m} - 1) = {s_6m:.4f}%")
print(f"Cross-check: PV = {F / (1 + s_6m/200):.4f}  (should be {P_6m})")


# ── Problem 2 ─────────────────────────────────────────────────────────────────
separator("Problem 2 — Bootstrap 1Y spot from 1Y coupon bond")
# s_6m = 5.0%, 1Y note: coupon 5%, price 100 (par bond)
s_6m_given = 5.0
par_2 = [(0.5, s_6m_given), (1.0, 5.0)]
spots_2 = bootstrap_spot_rates(par_2)

print(f"Given s_6m = {s_6m_given}%")
print(f"1Y Treasury: coupon = 5%, price = 100 (par bond)")
print()
print("Manual derivation:")
print("  100 = 2.5 / (1 + 0.05/2) + 102.5 / (1 + s_1y/2)^2")
print("  PV of 6M CF = 2.5 / 1.025 = 2.4390")
print("  102.5 / (1 + s_1y/2)^2 = 100 - 2.4390 = 97.5610")
print("  (1 + s_1y/2)^2 = 102.5 / 97.5610 = 1.05064")
print("  s_1y = 2 × (√1.05064 - 1)")

for t, s in spots_2:
    print(f"\nBootstrapped: {t}Y spot = {s:.4f}%")


# ── Problem 3 ─────────────────────────────────────────────────────────────────
separator("Problem 3 — Bootstrap 1.5Y spot")
# s_6m=5.0%, s_1y=5.2%, 1.5Y bond: coupon 5.5%, price 100.50
par_3 = [(0.5, 5.0), (1.0, 5.2), (1.5, 5.5)]
# Price is 100.50, NOT par — need to adjust
# For par bond: coupon = par_yield, price = 100
# Here coupon 5.5% bond trades at 100.50 — but bootstrapper assumes par bonds
# Instead, derive manually

s_6m  = 5.0 / 100
s_1y  = 5.2 / 100
coupon_semi = 100 * 0.055 / 2  # 2.75
price = 100.50

pv_1 = coupon_semi / (1 + s_6m / 2) ** 1
pv_2 = coupon_semi / (1 + s_1y / 2) ** 2
remaining = price - pv_1 - pv_2
# remaining = (coupon_semi + 100) / (1 + s_15/2)^3
s_15_half = ((coupon_semi + 100) / remaining) ** (1/3) - 1
s_15 = s_15_half * 2 * 100

print(f"s_6m={s_6m*100}%, s_1y={s_1y*100}%")
print(f"1.5Y bond: coupon 5.5%, price 100.50")
print(f"PV(6M CF) = {pv_1:.4f}")
print(f"PV(1Y CF) = {pv_2:.4f}")
print(f"PV remaining = {remaining:.4f}")
print(f"s_1.5y = {s_15:.4f}%")


# ── Problem 4 ─────────────────────────────────────────────────────────────────
separator("Problem 4 — Price 2Y bond from spot curve, compute YTM")
# s_6m=5.0%, s_1y=5.2%, s_1.5y=5.35%, s_2y=5.5%
# 2Y bond: coupon 6% semi-annual
spot_rates_4 = [(0.5, 5.0), (1.0, 5.2), (1.5, 5.35), (2.0, 5.5)]
result = price_from_spot_curve(coupon_rate_pct=6.0, tenor_years=2.0,
                               spot_rates=spot_rates_4, face=100.0)

print(f"Spot rates: {spot_rates_4}")
print(f"6% semi-annual coupon, 2Y maturity, face = 100")
print()
print(f"{'Period':>6}  {'t(Y)':>5}  {'CF':>6}  {'Spot%':>7}  {'DF':>8}  {'PV':>8}")
print("-" * 50)
for row in result["schedule"]:
    print(f"{row['period']:>6}  {row['t_years']:>5}  {row['cf']:>6.2f}  "
          f"{row['spot_pct']:>6.3f}%  {row['df']:>8.6f}  {row['pv']:>8.4f}")
print(f"\nPrice = {result['price']:.4f}")
print(f"YTM   = {result['ytm_pct']:.4f}%")
print(f"\n2Y spot = 5.50% — YTM = {result['ytm_pct']:.4f}%")
print("YTM is BELOW the 2Y spot because earlier cash flows are discounted at LOWER")
print("spot rates (5.0%, 5.2%, 5.35%), pulling the blended YTM below the 2Y spot.")


# ── Problem 5 ─────────────────────────────────────────────────────────────────
separator("Problem 5 — Linear interpolation: 3Y and 4Y spot rates")
# s_2y = 5.5%, s_5y = 6.0%
known = [(2.0, 5.5), (5.0, 6.0)]
targets = [3.0, 4.0]
interp  = interpolate_curve(known, targets)

print(f"s_2y = 5.5%, s_5y = 6.0%")
print(f"Linear interpolation: s_t = s_2 + (s_5 - s_2) × (t - 2) / (5 - 2)")
print()
for t, s in interp:
    manual = 5.5 + (6.0 - 5.5) * (t - 2) / (5 - 2)
    print(f"s_{int(t)}y = {s:.4f}%  (manual: {manual:.4f}%)")

print()
print("Note: linear interpolation creates straight-line segments between nodes.")
print("Cubic splines (scipy.interpolate.CubicSpline) give smoother curves")
print("and are used in production curve construction.")
