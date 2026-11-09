"""
src/nelson_siegel.py

Nelson-Siegel (1987) parametric yield curve model.

Formula:
    y(τ) = β₀ + β₁·f₁(τ) + β₂·f₂(τ)

    f₁(τ) = (1 - e^(-τ/λ)) / (τ/λ)          ← slope loading
    f₂(τ) = (1 - e^(-τ/λ)) / (τ/λ) - e^(-τ/λ)  ← curvature/hump loading

Parameters:
    β₀ = long-run level    (as τ→∞, y→β₀)
    β₁ = slope component   (as τ→0, y→β₀+β₁)
    β₂ = curvature/hump    (controls belly shape)
    λ  = decay factor      (where hump peaks, typically 2-3 years)

Estimation: minimise Σ (y_observed - y_NS)² over {β₀, β₁, β₂, λ}.
For a fixed λ the model is linear in the betas, so they are solved by OLS;
λ is chosen by a log-spaced grid search (pure Python, no dependencies).
"""

import math


# ── CORE NS FORMULA ───────────────────────────────────────────────────────────

def ns_yield(tau, beta0, beta1, beta2, lam):
    """
    Nelson-Siegel yield at maturity tau.

    Args:
        tau:   maturity in years (> 0)
        beta0: long-run level (percent)
        beta1: slope component (percent)
        beta2: curvature/hump (percent)
        lam:   decay factor (years)

    Returns:
        yield in percent
    """
    if tau <= 0:
        return beta0 + beta1

    x   = tau / lam
    # Guard against overflow for very large tau/lambda ratios
    exp_x = math.exp(-x) if x < 500 else 0.0

    f1  = (1 - exp_x) / x          # slope loading  → 1 as τ→0, → 0 as τ→∞
    f2  = f1 - exp_x                 # hump loading   → 0 at both ends, peaks at τ≈λ

    return beta0 + beta1 * f1 + beta2 * f2


def ns_curve(beta0, beta1, beta2, lam, tenors):
    """
    Compute NS yields at a list of maturities.

    Returns list of (tenor, yield_pct).
    """
    return [(t, ns_yield(t, beta0, beta1, beta2, lam)) for t in tenors]


def ns_loadings(lam, tenors):
    """
    Return the three NS basis function values at each tenor.
    Useful for visualising how each parameter shapes the curve.

    Returns list of {"tenor", "f0" (constant=1), "f1" (slope), "f2" (hump)}.
    """
    result = []
    for tau in tenors:
        if tau <= 0:
            result.append({"tenor": tau, "f0": 1.0, "f1": 1.0, "f2": 0.0})
            continue
        x     = tau / lam
        exp_x = math.exp(-x) if x < 500 else 0.0
        f1    = (1 - exp_x) / x
        f2    = f1 - exp_x
        result.append({"tenor": tau, "f0": 1.0, "f1": round(f1, 6), "f2": round(f2, 6)})
    return result


# ── FITTING ───────────────────────────────────────────────────────────────────

def fit_ns(tenors, yields_pct, lam_init=2.0, lam_min=0.1, lam_max=10.0):
    """
    Fit Nelson-Siegel parameters to observed yields by OLS.

    For a fixed λ, the problem is linear in β₀, β₁, β₂ (OLS).
    We grid-search over λ to find the global minimum.

    Args:
        tenors:     list of maturities in years
        yields_pct: list of observed yields in percent (same length as tenors)
        lam_init:   initial λ guess (not used — we grid search instead)
        lam_min:    minimum λ to consider
        lam_max:    maximum λ to consider

    Returns:
        {
            "beta0", "beta1", "beta2", "lambda",
            "fitted":  [(tenor, fitted_yield), ...],
            "residuals": [(tenor, residual_bp), ...],
            "rmse_bp": float,
        }
    """
    best = None
    best_sse = float("inf")

    # Grid search over lambda (40 points log-spaced from lam_min to lam_max)
    n_grid = 40
    lam_grid = [
        lam_min * (lam_max / lam_min) ** (i / (n_grid - 1))
        for i in range(n_grid)
    ]

    for lam in lam_grid:
        # Build design matrix X: columns are [1, f1(τ), f2(τ)]
        X = []
        for tau in tenors:
            if tau <= 0:
                X.append([1.0, 1.0, 0.0])
                continue
            x_val  = tau / lam
            exp_x  = math.exp(-x_val) if x_val < 500 else 0.0
            f1     = (1 - exp_x) / x_val
            f2     = f1 - exp_x
            X.append([1.0, f1, f2])

        # OLS: β = (XᵀX)⁻¹ Xᵀy
        betas = _ols(X, yields_pct)
        if betas is None:
            continue

        b0, b1, b2 = betas
        sse = sum(
            (yields_pct[i] - ns_yield(tenors[i], b0, b1, b2, lam)) ** 2
            for i in range(len(tenors))
        )

        if sse < best_sse:
            best_sse = sse
            best = (b0, b1, b2, lam)

    if best is None:
        raise ValueError("NS fitting failed — check input data.")

    b0, b1, b2, lam = best
    n = len(tenors)

    fitted    = [(tenors[i], ns_yield(tenors[i], b0, b1, b2, lam)) for i in range(n)]
    residuals = [(tenors[i], (yields_pct[i] - fitted[i][1]) * 100) for i in range(n)]  # in bp
    rmse_bp   = math.sqrt(sum(r**2 for _, r in residuals) / n)

    return {
        "beta0":     round(b0, 6),
        "beta1":     round(b1, 6),
        "beta2":     round(b2, 6),
        "lambda":    round(lam, 6),
        "fitted":    [(round(t, 4), round(y, 6)) for t, y in fitted],
        "residuals": [(round(t, 4), round(r, 4)) for t, r in residuals],
        "rmse_bp":   round(rmse_bp, 4),
    }


def _ols(X, y):
    """
    Solve OLS β = (XᵀX)⁻¹Xᵀy for a 3-column design matrix.
    Pure Python — no numpy needed.
    Returns [b0, b1, b2] or None if singular.
    """
    n, k = len(X), len(X[0])  # k = 3

    # XᵀX  (3x3)
    XtX = [[sum(X[i][r] * X[i][c] for i in range(n)) for c in range(k)] for r in range(k)]
    # Xᵀy  (3x1)
    Xty = [sum(X[i][r] * y[i] for i in range(n)) for r in range(k)]

    # Invert XᵀX via Gaussian elimination
    inv = _invert_3x3(XtX)
    if inv is None:
        return None

    return [sum(inv[r][c] * Xty[c] for c in range(k)) for r in range(k)]


def _invert_3x3(M):
    """Invert a 3x3 matrix. Returns None if singular."""
    # Augment with identity
    A = [row[:] + [1 if i == j else 0 for j in range(3)] for i, row in enumerate(M)]

    for col in range(3):
        # Pivot
        pivot = max(range(col, 3), key=lambda r: abs(A[r][col]))
        A[col], A[pivot] = A[pivot], A[col]
        if abs(A[col][col]) < 1e-12:
            return None
        div = A[col][col]
        A[col] = [v / div for v in A[col]]
        for row in range(3):
            if row != col:
                factor = A[row][col]
                A[row] = [A[row][j] - factor * A[col][j] for j in range(6)]

    return [row[3:] for row in A]


# ── PARAMETER INTERPRETATION ──────────────────────────────────────────────────

def interpret_params(beta0, beta1, beta2, lam):
    """
    Human-readable interpretation of fitted NS parameters.
    """
    short_rate  = beta0 + beta1
    long_rate   = beta0
    ratio = 1 + beta2 / beta1 if beta1 != 0 else 1.0
    hump_tenor  = lam * math.log(ratio) if ratio > 0 else lam
    slope       = long_rate - short_rate  # positive = normal, negative = inverted

    shape = "humped" if beta2 > 0.1 else "inverted hump" if beta2 < -0.1 else "monotone"
    curve = "normal (upward sloping)" if slope > 0.05 else \
            "inverted (downward sloping)" if slope < -0.05 else "flat"

    return {
        "short_rate_pct":  round(short_rate, 4),
        "long_rate_pct":   round(long_rate, 4),
        "slope_bp":        round(slope * 100, 2),
        "curve_shape":     curve,
        "belly_shape":     shape,
        "hump_peak_years": round(max(0, hump_tenor), 2),
    }


def extrapolate(beta0, beta1, beta2, lam, max_tenor=50, step=0.25):
    """
    Generate a dense fitted curve for plotting, from 0.25Y to max_tenor.
    Returns list of (tenor, yield_pct).
    """
    tenors = [i * step for i in range(1, int(max_tenor / step) + 1)]
    return ns_curve(beta0, beta1, beta2, lam, tenors)


if __name__ == "__main__":
    # Fit to an example curve
    tenors     = [0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
    yields_pct = [5.3,  5.2, 4.9, 4.6, 4.4,  4.5,  4.7]

    result = fit_ns(tenors, yields_pct)

    print("Fitted parameters:")
    print(f"  β₀ = {result['beta0']:.4f}%  (long-run level)")
    print(f"  β₁ = {result['beta1']:.4f}%  (slope)")
    print(f"  β₂ = {result['beta2']:.4f}%  (curvature)")
    print(f"  λ  = {result['lambda']:.4f}Y  (decay)")
    print(f"  RMSE = {result['rmse_bp']:.4f} bp")

    interp = interpret_params(result['beta0'], result['beta1'],
                               result['beta2'], result['lambda'])
    print("\nInterpretation:")
    for k, v in interp.items():
        print(f"  {k}: {v}")

    print("\nResiduals (bp):")
    for t, r in result['residuals']:
        print(f"  {t}Y: {r:+.2f} bp")
