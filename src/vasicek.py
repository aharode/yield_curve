"""
src/vasicek.py

Vasicek (1977) and CIR (1985) short-rate models.

Vasicek SDE:    dr = κ(θ - r)dt + σ dW
CIR SDE:        dr = κ(θ - r)dt + σ√r dW

Both are mean-reverting Ornstein-Uhlenbeck processes.
Vasicek allows negative rates. CIR prevents them when the Feller
condition holds: 2κθ > σ².

Analytical bond price (Vasicek):
    P(t,T) = A(t,T) · exp(-B(t,T) · r_t)
    B(t,T) = (1 - e^(-κτ)) / κ          where τ = T - t
    ln A   = (θ - σ²/2κ²)(B - τ) - σ²B²/4κ

Monte Carlo discretisation (Euler-Maruyama):
    r(t+Δt) = r(t) + κ(θ - r(t))Δt + σ√Δt · Z    Z ~ N(0,1)
    CIR:
    r(t+Δt) = r(t) + κ(θ - r(t))Δt + σ√(r(t)·Δt) · Z
"""

import math
import random


# ── VASICEK ANALYTICS ─────────────────────────────────────────────────────────

def vasicek_bond_price(r0, kappa, theta, sigma, tau):
    """
    Analytical zero-coupon bond price under Vasicek.

    P(0,T) = A(0,T) · exp(-B(0,T) · r₀)

    Args:
        r0:    current short rate (decimal, e.g. 0.05)
        kappa: mean reversion speed (κ > 0)
        theta: long-run mean (θ, decimal)
        sigma: volatility of short rate (σ)
        tau:   time to maturity in years (T - t)

    Returns:
        zero-coupon bond price (per $1 face)
    """
    if tau <= 0:
        return 1.0

    B   = (1 - math.exp(-kappa * tau)) / kappa
    lnA = (theta - sigma**2 / (2 * kappa**2)) * (B - tau) \
          - (sigma**2 * B**2) / (4 * kappa)

    return math.exp(lnA) * math.exp(-B * r0)


def vasicek_yield(r0, kappa, theta, sigma, tau):
    """
    Continuously compounded zero-coupon yield under Vasicek.
    y(t,T) = -ln P(t,T) / τ

    Returns yield as decimal.
    """
    if tau <= 0:
        return r0
    P = vasicek_bond_price(r0, kappa, theta, sigma, tau)
    return -math.log(P) / tau


def vasicek_term_structure(r0, kappa, theta, sigma, tenors):
    """
    Compute the full term structure of yields under Vasicek.

    Args:
        r0, kappa, theta, sigma: model parameters
        tenors: list of maturities in years

    Returns:
        list of (tenor, yield_percent)
    """
    return [
        (tau, vasicek_yield(r0, kappa, theta, sigma, tau) * 100)
        for tau in tenors
    ]


def vasicek_expected_rate(r0, kappa, theta, t):
    """
    E[r_t] = θ + (r₀ - θ) · e^(-κt)
    Derived from solving the Vasicek SDE exactly via Ito's Lemma.
    As t → ∞, E[r_t] → θ  (mean reversion).
    """
    return theta + (r0 - theta) * math.exp(-kappa * t)


def vasicek_variance(kappa, sigma, t):
    """
    Var[r_t] = σ²/(2κ) · (1 - e^(-2κt))
    As t → ∞, Var[r_t] → σ²/(2κ)  (stationary variance).
    """
    return (sigma**2 / (2 * kappa)) * (1 - math.exp(-2 * kappa * t))


# ── CIR ANALYTICS ─────────────────────────────────────────────────────────────

def feller_condition(kappa, theta, sigma):
    """
    Feller condition for CIR: 2κθ > σ²
    When satisfied, the short rate stays strictly positive.
    Returns (satisfies: bool, lhs: float, rhs: float)
    """
    lhs = 2 * kappa * theta
    rhs = sigma ** 2
    return lhs > rhs, lhs, rhs


def cir_bond_price(r0, kappa, theta, sigma, tau):
    """
    Analytical zero-coupon bond price under CIR (1985).

    P(t,T) = A(t,T) · exp(-B(t,T) · r₀)

    where:
        γ = √(κ² + 2σ²)
        B = 2(e^(γτ) - 1) / [(γ+κ)(e^(γτ)-1) + 2γ]
        A = [2γ·e^((κ+γ)τ/2) / ((γ+κ)(e^(γτ)-1) + 2γ)]^(2κθ/σ²)
    """
    if tau <= 0:
        return 1.0

    gamma = math.sqrt(kappa**2 + 2 * sigma**2)
    exp_gt = math.exp(gamma * tau)

    denom = (gamma + kappa) * (exp_gt - 1) + 2 * gamma
    B     = 2 * (exp_gt - 1) / denom
    A_exp = (2 * gamma * math.exp((kappa + gamma) * tau / 2)) / denom
    A     = A_exp ** (2 * kappa * theta / sigma**2)

    return A * math.exp(-B * r0)


def cir_yield(r0, kappa, theta, sigma, tau):
    """Continuously compounded yield under CIR. Returns decimal."""
    if tau <= 0:
        return r0
    P = cir_bond_price(r0, kappa, theta, sigma, tau)
    return -math.log(P) / tau


# ── MONTE CARLO ───────────────────────────────────────────────────────────────

def simulate_vasicek(r0, kappa, theta, sigma, T=5.0, dt=1/12,
                     n_paths=500, seed=None):
    """
    Monte Carlo simulation of Vasicek short rate paths.

    Euler-Maruyama discretisation:
        r(t+Δt) = r(t) + κ(θ - r(t))Δt + σ√Δt · Z    Z ~ N(0,1)

    Args:
        r0:      initial short rate (decimal)
        kappa:   mean reversion speed
        theta:   long-run mean (decimal)
        sigma:   volatility
        T:       horizon in years
        dt:      time step (default 1/12 = monthly)
        n_paths: number of simulation paths
        seed:    random seed for reproducibility

    Returns:
        {
            "times":    [0, dt, 2*dt, ...],      length n_steps+1
            "paths":    [[r values], ...],        shape (n_paths, n_steps+1)
            "mean":     [E[r_t] analytical, ...], length n_steps+1
            "params":   {kappa, theta, sigma, r0, T, dt, n_paths},
        }
    """
    if seed is not None:
        random.seed(seed)

    n_steps = round(T / dt)
    times   = [i * dt for i in range(n_steps + 1)]
    paths   = []

    for _ in range(n_paths):
        r    = r0
        path = [r]
        for _ in range(n_steps):
            z  = _standard_normal()
            dr = kappa * (theta - r) * dt + sigma * math.sqrt(dt) * z
            r  = r + dr          # Vasicek: can go negative
            path.append(r)
        paths.append(path)

    # Analytical mean path
    mean = [vasicek_expected_rate(r0, kappa, theta, t) for t in times]

    return {
        "times":  times,
        "paths":  paths,
        "mean":   mean,
        "params": {
            "kappa": kappa, "theta": theta, "sigma": sigma,
            "r0": r0, "T": T, "dt": dt, "n_paths": n_paths,
        },
    }


def simulate_cir(r0, kappa, theta, sigma, T=5.0, dt=1/12,
                 n_paths=500, seed=None):
    """
    Monte Carlo simulation of CIR short rate paths.

    Discretisation:
        r(t+Δt) = r(t) + κ(θ - r(t))Δt + σ√(max(r(t),0)·Δt) · Z

    The max(r,0) inside the sqrt prevents complex numbers if r goes
    slightly negative due to discretisation error when Feller fails.
    """
    if seed is not None:
        random.seed(seed)

    n_steps = round(T / dt)
    times   = [i * dt for i in range(n_steps + 1)]
    paths   = []

    for _ in range(n_paths):
        r    = r0
        path = [r]
        for _ in range(n_steps):
            z  = _standard_normal()
            dr = kappa * (theta - r) * dt + sigma * math.sqrt(max(r, 0) * dt) * z
            r  = max(r + dr, 0)  # hard floor at 0 as extra guard
            path.append(r)
        paths.append(path)

    mean = [vasicek_expected_rate(r0, kappa, theta, t) for t in times]

    return {
        "times":  times,
        "paths":  paths,
        "mean":   mean,
        "params": {
            "kappa": kappa, "theta": theta, "sigma": sigma,
            "r0": r0, "T": T, "dt": dt, "n_paths": n_paths,
            "feller": feller_condition(kappa, theta, sigma),
        },
    }


def path_statistics(simulation):
    """
    Compute cross-sectional statistics across all paths at each time step.

    Returns list of dicts:
        [{"t", "mean_sim", "mean_analytical", "std", "p5", "p95"}, ...]
    """
    times   = simulation["times"]
    paths   = simulation["paths"]
    mean_an = simulation["mean"]
    n       = len(paths)

    stats = []
    for i, t in enumerate(times):
        vals = sorted(p[i] for p in paths)
        mu   = sum(vals) / n
        var  = sum((v - mu)**2 for v in vals) / n
        idx5  = max(0, int(0.05 * n) - 1)
        idx95 = min(n - 1, int(0.95 * n))
        stats.append({
            "t":                round(t, 4),
            "mean_sim":         round(mu, 6),
            "mean_analytical":  round(mean_an[i], 6),
            "std":              round(math.sqrt(var), 6),
            "p5":               round(vals[idx5], 6),
            "p95":              round(vals[idx95], 6),
        })

    return stats


# ── CALIBRATION ───────────────────────────────────────────────────────────────

def calibrate_vasicek_moments(rates, dt):
    """
    Calibrate Vasicek parameters from a time series of short rates
    using method of moments (OLS on the discretised SDE).

    The discretised SDE gives:
        r(t+1) = r(t) + κθ·Δt - κ·r(t)·Δt + ε
               = α + β·r(t) + ε

    where α = κθ·Δt, β = 1 - κ·Δt
    So:  κ = (1 - β) / Δt,  θ = α / (κ·Δt)

    Args:
        rates: list of short rate observations (decimal)
        dt:    time step between observations (years)

    Returns:
        {"kappa", "theta", "sigma", "r_squared"}
    """
    n  = len(rates) - 1
    x  = rates[:-1]
    y  = rates[1:]

    # OLS: y = alpha + beta * x
    x_bar = sum(x) / n
    y_bar = sum(y) / n

    beta  = sum((x[i] - x_bar) * (y[i] - y_bar) for i in range(n)) / \
            sum((x[i] - x_bar)**2 for i in range(n))
    alpha = y_bar - beta * x_bar

    kappa = (1 - beta) / dt
    theta = alpha / (kappa * dt) if kappa != 0 else 0

    residuals = [y[i] - alpha - beta * x[i] for i in range(n)]
    sigma_dt  = math.sqrt(sum(r**2 for r in residuals) / n)
    sigma     = sigma_dt / math.sqrt(dt)

    # R-squared
    ss_res = sum(r**2 for r in residuals)
    ss_tot = sum((y[i] - y_bar)**2 for i in range(n))
    r2     = 1 - ss_res / ss_tot if ss_tot > 0 else 0

    return {
        "kappa":     round(kappa, 6),
        "theta":     round(theta, 6),
        "sigma":     round(sigma, 6),
        "r_squared": round(r2, 6),
    }


# ── ITOS LEMMA ILLUSTRATION ───────────────────────────────────────────────────

def itos_lemma_demo(kappa, theta, sigma, r0, dt=1/12):
    """
    Illustrates Ito's Lemma applied to f(r,t) = e^(κt) · r
    to solve the Vasicek SDE exactly.

    Step 1: Let f = e^(κt) · r
    Step 2: Apply Ito's Lemma:
        df = (∂f/∂t + μ·∂f/∂r + ½σ²·∂²f/∂r²)dt + σ·∂f/∂r·dW
    where dr = κ(θ-r)dt + σdW so μ = κ(θ-r)

        ∂f/∂t   = κ·e^(κt)·r
        ∂f/∂r   = e^(κt)
        ∂²f/∂r² = 0  (f linear in r)

    df = [κ·e^(κt)·r + κ(θ-r)·e^(κt) + 0]dt + σ·e^(κt)·dW
       = κθ·e^(κt)dt + σ·e^(κt)·dW

    The r term cancels! Integrating:
        e^(κt)·r_t = r₀ + κθ·∫₀ᵗ e^(κs)ds + σ·∫₀ᵗ e^(κs)dW_s
        r_t = r₀·e^(-κt) + θ(1 - e^(-κt)) + σ·e^(-κt)·∫₀ᵗ e^(κs)dW_s

    Returns a dict summarising the derivation steps.
    """
    return {
        "substitution":     "f(r,t) = e^(κt) · r",
        "partial_t":        "∂f/∂t = κ · e^(κt) · r",
        "partial_r":        "∂f/∂r = e^(κt)",
        "partial_rr":       "∂²f/∂r² = 0  (linear in r)",
        "ito_expansion":    "df = [κ·e^(κt)·r + κ(θ-r)·e^(κt)]dt + σ·e^(κt)·dW",
        "simplification":   "df = κθ·e^(κt)dt + σ·e^(κt)·dW  [r cancels!]",
        "exact_solution":   "r_t = θ + (r₀-θ)·e^(-κt) + σ·e^(-κt)·∫₀ᵗ e^(κs)dW_s",
        "expected_value":   f"E[r_t] = θ + (r₀-θ)·e^(-κt) = {vasicek_expected_rate(r0, kappa, theta, 1.0)*100:.4f}% at t=1",
        "stationary_mean":  f"lim t→∞ E[r_t] = θ = {theta*100:.2f}%",
        "stationary_var":   f"lim t→∞ Var[r_t] = σ²/2κ = {(sigma**2)/(2*kappa)*100:.4f}% (in decimal²)",
    }


# ── UTILITIES ─────────────────────────────────────────────────────────────────

def _standard_normal():
    """Box-Muller transform for standard normal samples (no numpy needed)."""
    while True:
        u1 = random.random()
        u2 = random.random()
        if u1 > 0:
            break
    z = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
    return z


def simulation_to_ui_format(simulation, n_display=8, step=2):
    """
    Convert full simulation output to a compact format for the UI.
    Subsamples paths and time steps for performance.

    Returns list of dicts: [{"t": float, "r_pct": float, "path_id": int}, ...]
    """
    paths   = simulation["paths"][:n_display]
    times   = simulation["times"]
    indices = list(range(0, len(times), step))

    result = []
    for pid, path in enumerate(paths):
        for i in indices:
            result.append({
                "path_id": pid,
                "t":       round(times[i], 3),
                "r_pct":   round(path[i] * 100, 4),
            })
    return result


if __name__ == "__main__":
    # Quick smoke test
    print("Vasicek bond prices (r0=3%, κ=0.3, θ=5%, σ=1.8%):")
    r0, kappa, theta, sigma = 0.03, 0.3, 0.05, 0.018
    for tau in [1, 2, 5, 10, 30]:
        p = vasicek_bond_price(r0, kappa, theta, sigma, tau)
        y = vasicek_yield(r0, kappa, theta, sigma, tau) * 100
        print(f"  {tau:>2}Y:  P = {p:.6f}  y = {y:.4f}%")

    print("\nIto's Lemma derivation:")
    demo = itos_lemma_demo(kappa, theta, sigma, r0)
    for k, v in demo.items():
        print(f"  {k}: {v}")

    print("\nFeller condition (CIR):")
    ok, lhs, rhs = feller_condition(kappa, theta, sigma)
    print(f"  2κθ = {lhs:.6f} > σ² = {rhs:.6f}? {ok}")
