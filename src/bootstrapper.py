"""
src/bootstrapper.py — Day 4 & 5

Extracts spot (zero-coupon) rates from par yields recursively.
Implements the bootstrapping algorithm from the study guide exactly.

Key formulas:
    Step 1 (6M T-bill, zero coupon):
        s_6m = 2 * (F/P - 1)

    Step 2+ (coupon bonds):
        P = Σ [C/2 / (1 + s_t/2)^t]  +  (C/2 + F) / (1 + s_T/2)^T
        Solve for s_T — only unknown at each step.

    Forward rates (no-arbitrage):
        f(T1, T2) = [(1 + s_T2/2)^(2*T2) / (1 + s_T1/2)^(2*T1)]^(1/(2*(T2-T1))) - 1
        annualised: multiply by 2 for semi-annual convention

    Linear interpolation:
        s_t = s_T1 + (s_T2 - s_T1) * (t - T1) / (T2 - T1)
"""

import math


# ── CORE BOOTSTRAPPING ────────────────────────────────────────────────────────

def bootstrap_spot_rates(par_yields, face=100.0):
    """
    Bootstrap spot rates from par yields using recursive extraction.

    Args:
        par_yields: list of (tenor_years, par_yield_percent)
                    sorted ascending by tenor.
                    e.g. [(0.5, 5.30), (1.0, 5.10), (2.0, 4.80), ...]
        face:       face value (default 100)

    Returns:
        list of (tenor_years, spot_rate_percent) sorted ascending

    Algorithm (semi-annual compounding throughout):
        - 0.5Y: direct from T-bill price (zero coupon)
        - 1Y+ : strip out known cash flows using already-derived spot rates,
                solve for the new spot rate algebraically.

    The par yield convention means each bond prices AT PAR (price = face).
    So for a par bond: coupon = par_yield, and price = face.
    """
    par_yields = sorted(par_yields)
    spots = {}  # tenor -> spot rate (decimal, not percent)

    for tenor, par_yield_pct in par_yields:
        par_yield = par_yield_pct / 100.0
        coupon    = par_yield         # par bond: coupon rate = par yield
        n_periods = round(tenor * 2)  # number of semi-annual periods

        if n_periods == 1:
            # 6-month zero coupon: P = F/(1 + s/2) = F (par), so s/2 = coupon/2
            # Direct: s_6m = par_yield (by definition for par bond at 6M)
            spot = par_yield
            spots[tenor] = spot
            continue

        # For coupon bonds: price = face (par bond)
        # Σ_{t=1}^{N-1} [coupon/2 * face / (1 + s_t/2)^t]  +  (coupon/2 + 1) * face / (1 + s_N/2)^N = face
        # Divide through by face:
        # Σ_{t=1}^{N-1} [(coupon/2) / (1 + s_t/2)^t]  +  (coupon/2 + 1) / (1 + s_N/2)^N = 1

        # Sum the PV of all cash flows EXCEPT the last one
        pv_early = 0.0
        for t in range(1, n_periods):
            t_years     = t / 2.0
            s_t         = _interpolate_spot(spots, t_years)
            discount    = (1 + s_t / 2) ** t
            pv_early   += (coupon / 2) / discount

        # Solve for spot rate at this tenor:
        # (coupon/2 + 1) / (1 + s_N/2)^N = 1 - pv_early
        # (1 + s_N/2)^N = (coupon/2 + 1) / (1 - pv_early)
        # s_N = 2 * [(coupon/2 + 1) / (1 - pv_early)]^(1/N) - 2

        rhs     = (coupon / 2 + 1) / (1 - pv_early)
        spot    = 2 * (rhs ** (1 / n_periods) - 1)
        spots[tenor] = spot

    return [(t, s * 100) for t, s in sorted(spots.items())]


def _interpolate_spot(spots, tenor):
    """
    Linear interpolation of spot rates for intermediate tenors.
    spots: dict of {tenor_years: spot_rate_decimal}
    Returns spot rate as decimal.
    """
    tenors = sorted(spots.keys())

    if not tenors:
        raise ValueError("No spot rates available yet for interpolation.")

    if tenor in spots:
        return spots[tenor]

    # Extrapolate flat below minimum tenor
    if tenor < tenors[0]:
        return spots[tenors[0]]

    # Extrapolate flat above maximum tenor
    if tenor > tenors[-1]:
        return spots[tenors[-1]]

    # Linear interpolation between bracketing tenors
    for i in range(len(tenors) - 1):
        t1, t2 = tenors[i], tenors[i + 1]
        if t1 <= tenor <= t2:
            w = (tenor - t1) / (t2 - t1)
            return spots[t1] + w * (spots[t2] - spots[t1])

    return spots[tenors[-1]]


# ── FORWARD RATES ─────────────────────────────────────────────────────────────

def spot_to_forward(spot_rates):
    """
    Compute implied forward rates from spot rates.
    No-arbitrage condition (semi-annual compounding):
        (1 + s_T2/2)^(2*T2) = (1 + s_T1/2)^(2*T1) * (1 + f(T1,T2)/2)^(2*(T2-T1))

    Args:
        spot_rates: list of (tenor_years, spot_rate_percent)

    Returns:
        list of (tenor_years, forward_rate_percent)
        where forward rate at tenor T is the instantaneous forward f(T-Δ, T)
        i.e. the rate for the period immediately ending at T.
    """
    spots = sorted(spot_rates)
    forwards = []

    for i in range(len(spots)):
        tenor_T2, s_T2_pct = spots[i]
        s_T2 = s_T2_pct / 100.0

        if i == 0:
            # First point: forward = spot (no prior period to compare)
            forwards.append((tenor_T2, s_T2_pct))
            continue

        tenor_T1, s_T1_pct = spots[i - 1]
        s_T1 = s_T1_pct / 100.0

        n1 = tenor_T1 * 2  # periods for T1
        n2 = tenor_T2 * 2  # periods for T2
        dn = n2 - n1        # periods in the forward window

        # (1 + s2/2)^n2 / (1 + s1/2)^n1 = (1 + f/2)^dn
        growth_ratio = ((1 + s_T2 / 2) ** n2) / ((1 + s_T1 / 2) ** n1)
        fwd          = 2 * (growth_ratio ** (1 / dn) - 1)
        forwards.append((tenor_T2, fwd * 100))

    return forwards


def forward_rate(s1_pct, T1, s2_pct, T2):
    """
    Compute a single forward rate f(T1, T2).

    Args:
        s1_pct: spot rate at T1 (percent)
        T1:     start tenor (years)
        s2_pct: spot rate at T2 (percent)
        T2:     end tenor (years)

    Returns:
        annualised forward rate (percent), semi-annual compounding

    Example:
        # 1Y/1Y forward: invest 2Y vs roll 1Y + 1Y forward
        f = forward_rate(s1_pct=3.0, T1=1, s2_pct=4.0, T2=2)
    """
    s1, s2 = s1_pct / 100, s2_pct / 100
    n1, n2 = T1 * 2, T2 * 2
    dn     = n2 - n1
    ratio  = ((1 + s2 / 2) ** n2) / ((1 + s1 / 2) ** n1)
    return 2 * (ratio ** (1 / dn) - 1) * 100


# ── INTERPOLATION ─────────────────────────────────────────────────────────────

def interpolate_curve(spot_rates, tenors, method="linear"):
    """
    Interpolate spot rates at arbitrary tenors.

    Args:
        spot_rates: list of (tenor, spot_pct) — known nodes
        tenors:     list of tenors to interpolate at
        method:     "linear" (default) — cubic spline added in Day 5 extension

    Returns:
        list of (tenor, interpolated_spot_pct)
    """
    known = dict(spot_rates)
    known_tenors = sorted(known.keys())

    result = []
    for t in tenors:
        if t in known:
            result.append((t, known[t]))
            continue

        if t <= known_tenors[0]:
            result.append((t, known[known_tenors[0]]))
            continue

        if t >= known_tenors[-1]:
            result.append((t, known[known_tenors[-1]]))
            continue

        for i in range(len(known_tenors) - 1):
            t1, t2 = known_tenors[i], known_tenors[i + 1]
            if t1 <= t <= t2:
                w = (t - t1) / (t2 - t1)
                s = known[t1] + w * (known[t2] - known[t1])
                result.append((t, s))
                break

    return result


# ── PRICE FROM SPOT CURVE ─────────────────────────────────────────────────────

def price_from_spot_curve(coupon_rate_pct, tenor_years, spot_rates, face=100.0):
    """
    Price a par coupon bond using the spot curve instead of a single YTM.
    This is the 'correct' pricing — each cash flow discounted at its own spot rate.

    Args:
        coupon_rate_pct: annual coupon rate (percent), semi-annual payments
        tenor_years:     maturity in years
        spot_rates:      list of (tenor, spot_pct) — bootstrapped
        face:            face value (default 100)

    Returns:
        dict with price, ytm (approximate), and cash flow schedule
    """
    coupon_semi = face * (coupon_rate_pct / 100) / 2
    n_periods   = round(tenor_years * 2)
    known       = dict(spot_rates)

    schedule = []
    price    = 0.0

    for t in range(1, n_periods + 1):
        t_years  = t / 2.0
        cf       = coupon_semi + (face if t == n_periods else 0)
        s_t      = _interpolate_spot(
            {k: v / 100 for k, v in known.items()}, t_years
        )
        df       = 1 / (1 + s_t / 2) ** t
        pv       = cf * df
        price   += pv
        schedule.append({
            "period":   t,
            "t_years":  t_years,
            "cf":       round(cf, 4),
            "spot_pct": round(s_t * 100, 4),
            "df":       round(df, 6),
            "pv":       round(pv, 4),
        })

    # Approximate YTM by Newton-Raphson (same as bond.py)
    ytm = _solve_ytm(coupon_semi, n_periods, face, price)

    return {
        "price":    round(price, 4),
        "ytm_pct":  round(ytm * 100, 4),
        "schedule": schedule,
    }


def _solve_ytm(coupon_semi, n_periods, face, price, tol=1e-10, max_iter=200):
    """Newton-Raphson YTM solver (semi-annual)."""
    y = coupon_semi / face  # initial guess: approx current yield / 2
    for _ in range(max_iter):
        pv   = sum(coupon_semi / (1 + y) ** t for t in range(1, n_periods + 1))
        pv  += face / (1 + y) ** n_periods
        dpv  = sum(-t * coupon_semi / (1 + y) ** (t + 1) for t in range(1, n_periods + 1))
        dpv -= n_periods * face / (1 + y) ** (n_periods + 1)
        dy   = (pv - price) / dpv
        y   -= dy
        if abs(dy) < tol:
            break
    return y * 2  # annualise


# ── SUMMARY ───────────────────────────────────────────────────────────────────

def curve_summary(par_yields):
    """
    Full pipeline: par yields -> spot rates -> forward rates.

    Args:
        par_yields: list of (tenor_years, par_yield_pct)

    Returns:
        {
            "spots":    [(tenor, spot_pct), ...],
            "forwards": [(tenor, fwd_pct), ...],
            "spreads":  {"2s10s": float, "2s30s": float, "5s30s": float},
        }
    """
    spots    = bootstrap_spot_rates(par_yields)
    forwards = spot_to_forward(spots)

    spot_dict = dict(spots)
    spreads   = {}
    for label, t1, t2 in [("2s10s", 2.0, 10.0), ("2s30s", 2.0, 30.0), ("5s30s", 5.0, 30.0)]:
        if t1 in spot_dict and t2 in spot_dict:
            spreads[label] = round(spot_dict[t2] - spot_dict[t1], 4)

    return {"spots": spots, "forwards": forwards, "spreads": spreads}


if __name__ == "__main__":
    # Quick smoke test with study guide numbers
    par = [(0.5, 5.0), (1.0, 5.2), (1.5, 5.35), (2.0, 5.5)]
    result = curve_summary(par)
    print("Spot rates:")
    for t, s in result["spots"]:
        print(f"  {t}Y: {s:.4f}%")
    print("\nForward rates:")
    for t, f in result["forwards"]:
        print(f"  {t}Y: {f:.4f}%")
    print("\nSpreads:", result["spreads"])
