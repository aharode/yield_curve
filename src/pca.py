"""
src/pca.py

PCA decomposition of yield curve moves.

Methodology:
    1. Compute daily changes in yields: Δy(t) = y(t) - y(t-1)
    2. Build covariance matrix Σ of Δy across maturities
    3. Eigendecompose: Σ = V·Λ·Vᵀ
    4. Sort eigenvectors by descending eigenvalue
    5. The first 3 PCs explain most of the variance:
         PC1 ≈ level      (all tenors same sign)
         PC2 ≈ slope      (short vs long end diverge)
         PC3 ≈ curvature  (belly vs wings)
       Shares depend on the sample and tenors; including T-bills lowers PC1's share,
       because bill yields are anchored to the policy rate.

Uses Jacobi iteration for eigendecomposition.
"""

import math


# ── MAIN PCA PIPELINE ─────────────────────────────────────────────────────────

def run_pca(dates, tenors, yield_matrix, n_components=3):
    """
    Full PCA pipeline on a historical yield curve matrix.

    Args:
        dates:        list of date strings, length T
        tenors:       list of maturities in years, length M
        yield_matrix: list of lists, shape (T, M) — yields in percent
        n_components: number of PCs to return (default 3)

    Returns:
        {
            "tenors":        [tenor list],
            "eigenvalues":   [λ₁, λ₂, ...],          sorted descending
            "variance_pct":  [pct explained per PC],
            "cum_variance":  [cumulative pct],
            "loadings":      [[pc1_loadings], [pc2_loadings], ...],
            "scores":        [[pc1_scores by date], ...],
            "mean_yields":   [mean yield per tenor],
            "n_obs":         int,
        }
    """
    T = len(yield_matrix)
    M = len(tenors)

    # Step 1: daily changes
    delta = [
        [yield_matrix[t][m] - yield_matrix[t-1][m] for m in range(M)]
        for t in range(1, T)
    ]
    n_obs = len(delta)

    # Step 2: demean (changes already near zero mean, but be rigorous)
    col_means = [sum(delta[t][m] for t in range(n_obs)) / n_obs for m in range(M)]
    delta_dm  = [[delta[t][m] - col_means[m] for m in range(M)] for t in range(n_obs)]

    # Step 3: covariance matrix (M x M)
    cov = _covariance(delta_dm, M)

    # Step 4: eigendecomposition via Jacobi iteration
    eigenvalues, eigenvectors = _jacobi_eigen(cov, M)

    # Step 5: sort descending
    order       = sorted(range(M), key=lambda i: -eigenvalues[i])
    eigenvalues = [eigenvalues[i] for i in order]
    eigenvectors = [[eigenvectors[r][order[c]] for c in range(M)] for r in range(M)]

    total_var   = sum(eigenvalues)
    var_pct     = [ev / total_var * 100 for ev in eigenvalues]
    cum_var     = []
    running     = 0
    for v in var_pct:
        running += v
        cum_var.append(running)

    # PC loadings (columns of eigenvectors, each length M)
    loadings = []
    for k in range(min(n_components, M)):
        loading = [eigenvectors[m][k] for m in range(M)]
        # Normalise sign: PC1 should have mostly positive loadings (level factor)
        if k == 0 and sum(loading) < 0:
            loading = [-v for v in loading]
        # PC2: short end should be negative (flattener interpretation)
        if k == 1 and loading[0] > 0:
            loading = [-v for v in loading]
        loadings.append([round(v, 6) for v in loading])

    # PC scores (project demeaned changes onto loadings)
    scores = []
    for k in range(min(n_components, M)):
        score = [
            sum(delta_dm[t][m] * loadings[k][m] for m in range(M))
            for t in range(n_obs)
        ]
        scores.append([round(s, 6) for s in score])

    mean_yields = [
        sum(yield_matrix[t][m] for t in range(T)) / T for m in range(M)
    ]

    return {
        "tenors":       tenors,
        "eigenvalues":  [round(ev, 8) for ev in eigenvalues[:n_components]],
        "variance_pct": [round(v, 4) for v in var_pct[:n_components]],
        "cum_variance": [round(v, 4) for v in cum_var[:n_components]],
        "loadings":     loadings,
        "scores":       scores,
        "dates":        dates[1:],       # one fewer than yields (diff)
        "mean_yields":  [round(v, 4) for v in mean_yields],
        "n_obs":        n_obs,
    }


def loading_table(pca_result):
    """
    Format loadings as a list of dicts for display.

    Returns: [{"tenor": t, "pc1": v1, "pc2": v2, "pc3": v3}, ...]
    """
    tenors   = pca_result["tenors"]
    loadings = pca_result["loadings"]
    n_pc     = len(loadings)

    rows = []
    for i, t in enumerate(tenors):
        row = {"tenor": t}
        for k in range(n_pc):
            row[f"pc{k+1}"] = loadings[k][i]
        rows.append(row)
    return rows


def factor_interpretation(pca_result, tol=0.02):
    """
    Label each PC as level / slope / curvature from the sign pattern of its loadings.

    Counts sign changes across maturities, ignoring loadings smaller than `tol`
    in absolute value (near-zero values flip sign on noise):
        0 sign changes -> level      (all maturities move the same way)
        1 sign change  -> slope      (short end vs long end)
        2+             -> curvature  (belly vs wings)

    Real-data loadings are rarely monotone (e.g. the slope factor often dips
    through the bills before rising), so the sign pattern is the robust test.
    """
    labels = []
    for loading in pca_result["loadings"]:
        signs = [1 if v > 0 else -1 for v in loading if abs(v) >= tol]
        changes = sum(1 for a, b in zip(signs, signs[1:]) if a != b)
        if changes == 0:
            labels.append("Level — parallel shift of all maturities")
        elif changes == 1:
            labels.append("Slope — short vs long end diverge (steepener/flattener)")
        else:
            labels.append("Curvature — belly vs wings (butterfly trade)")
    return labels


def portfolio_pca_risk(loadings_table, positions):
    """
    Decompose portfolio DV01 into PC1/PC2/PC3 exposures.

    Args:
        loadings_table: output of loading_table()
        positions: dict {tenor: dv01_dollars} e.g. {2: 50000, 10: -80000}

    Returns:
        {"pc1_dv01", "pc2_dv01", "pc3_dv01", "total_dv01"}
    """
    pc_keys = [k for k in loadings_table[0].keys() if k.startswith("pc")]
    result  = {k: 0.0 for k in pc_keys}
    total   = 0.0

    for row in loadings_table:
        t   = row["tenor"]
        dv1 = positions.get(t, 0.0)
        total += dv1
        for k in pc_keys:
            result[k] += dv1 * row[k]

    result["total_dv01"] = round(total, 2)
    for k in pc_keys:
        result[k] = round(result[k], 2)
    return result


# ── COVARIANCE & EIGEN ────────────────────────────────────────────────────────

def _covariance(data, M):
    """Compute M×M sample covariance matrix from (N×M) demeaned data."""
    N   = len(data)
    cov = [[0.0] * M for _ in range(M)]
    for i in range(M):
        for j in range(i, M):
            c = sum(data[t][i] * data[t][j] for t in range(N)) / (N - 1)
            cov[i][j] = c
            cov[j][i] = c
    return cov


def _jacobi_eigen(A, n, max_iter=1000, tol=1e-10):
    """
    Jacobi iteration for eigenvalues/vectors of a real symmetric matrix.
    Returns (eigenvalues list, eigenvectors as n×n list of columns).
    """
    # Work on a copy
    S = [row[:] for row in A]
    V = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]

    converged = False
    for _ in range(max_iter):
        # Find largest off-diagonal element
        p, q, max_val = 0, 1, 0.0
        for i in range(n):
            for j in range(i+1, n):
                if abs(S[i][j]) > max_val:
                    max_val = abs(S[i][j])
                    p, q = i, j

        if max_val < tol:
            converged = True
            break

        # Compute rotation angle
        if abs(S[p][p] - S[q][q]) < 1e-15:
            theta = math.pi / 4
        else:
            theta = 0.5 * math.atan2(2 * S[p][q], S[p][p] - S[q][q])

        c = math.cos(theta)
        s = math.sin(theta)

        # Apply Jacobi rotation
        S_new = [row[:] for row in S]
        for i in range(n):
            if i != p and i != q:
                S_new[i][p] = c * S[i][p] + s * S[i][q]
                S_new[p][i] = S_new[i][p]
                S_new[i][q] = -s * S[i][p] + c * S[i][q]
                S_new[q][i] = S_new[i][q]

        S_new[p][p] = c**2 * S[p][p] + 2*c*s * S[p][q] + s**2 * S[q][q]
        S_new[q][q] = s**2 * S[p][p] - 2*c*s * S[p][q] + c**2 * S[q][q]
        S_new[p][q] = 0.0
        S_new[q][p] = 0.0
        S = S_new

        # Accumulate rotations into V
        for i in range(n):
            v_ip = V[i][p]
            v_iq = V[i][q]
            V[i][p] =  c * v_ip + s * v_iq
            V[i][q] = -s * v_ip + c * v_iq

    if not converged:
        raise RuntimeError(f"Jacobi eigendecomposition did not converge in {max_iter} iterations")

    eigenvalues = [S[i][i] for i in range(n)]
    return eigenvalues, V


if __name__ == "__main__":
    # Smoke test with synthetic yield history
    import random
    random.seed(42)

    tenors = [0.5, 1, 2, 5, 7, 10, 20, 30]
    M      = len(tenors)
    T      = 250  # ~1 year of daily data

    # Synthetic yields: level ~4.5%, small daily changes
    yields = []
    level  = 4.5
    for t in range(T):
        shock  = (random.gauss(0, 0.05))                    # level shock
        slope  = (random.gauss(0, 0.03)) * (1 - 2*t/T)     # slope drift
        row    = [level + shock - slope * (m - M/2)/M + random.gauss(0, 0.01)
                  for m in range(M)]
        yields.append(row)
        level += random.gauss(0, 0.02)

    dates = [f"2024-{str(i//21+1).zfill(2)}-{str(i%21+1).zfill(2)}" for i in range(T)]

    result = run_pca(dates, tenors, yields, n_components=3)

    print("PCA on synthetic yield curve (250 days, 8 tenors):")
    print(f"  n_obs = {result['n_obs']}")
    print()
    for k in range(3):
        print(f"  PC{k+1}: {result['variance_pct'][k]:.2f}% variance  "
              f"(cumulative: {result['cum_variance'][k]:.2f}%)")

    print()
    print("Loadings:")
    table = loading_table(result)
    print(f"  {'Tenor':>6}  {'PC1':>8}  {'PC2':>8}  {'PC3':>8}")
    for row in table:
        print(f"  {row['tenor']:>5}Y  {row['pc1']:>8.4f}  {row['pc2']:>8.4f}  {row['pc3']:>8.4f}")

    print()
    labels = factor_interpretation(result)
    for k, label in enumerate(labels):
        print(f"  PC{k+1}: {label}")
