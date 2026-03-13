import { useState } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Cell,
} from "recharts";

/* ─── HARDCODED STUB DATA (replaced by live fetches once Python is wired) ── */

const PAR_YIELDS = [
  { tenor: 0.5, par: 5.30 }, { tenor: 1,  par: 5.10 },
  { tenor: 2,  par: 4.80 }, { tenor: 3,  par: 4.65 },
  { tenor: 5,  par: 4.50 }, { tenor: 7,  par: 4.55 },
  { tenor: 10, par: 4.60 }, { tenor: 20, par: 4.80 },
  { tenor: 30, par: 4.90 },
];

// Bootstrapped spot rates (will come from bootstrapper.py)
const SPOT_RATES = [
  { tenor: 0.5, par: 5.30, spot: 5.32, fwd: 5.32 },
  { tenor: 1,   par: 5.10, spot: 5.14, fwd: 4.96 },
  { tenor: 2,   par: 4.80, spot: 4.86, fwd: 4.58 },
  { tenor: 3,   par: 4.65, spot: 4.72, fwd: 4.46 },
  { tenor: 5,   par: 4.50, spot: 4.59, fwd: 4.47 },
  { tenor: 7,   par: 4.55, spot: 4.65, fwd: 4.86 },
  { tenor: 10,  par: 4.60, spot: 4.72, fwd: 4.98 },
  { tenor: 20,  par: 4.80, spot: 4.96, fwd: 5.42 },
  { tenor: 30,  par: 4.90, spot: 5.08, fwd: 5.64 },
];

// Nelson-Siegel fitted curve (will come from nelson_siegel.py)
const NS_PARAMS = { b0: 4.90, b1: -0.55, b2: 0.80, lambda: 2.4 };
function nsYield(tau, { b0, b1, b2, lambda }) {
  if (tau <= 0) return b0 + b1;
  const x = tau / lambda;
  const f1 = (1 - Math.exp(-x)) / x;
  const f2 = f1 - Math.exp(-x);
  return b0 + b1 * f1 + b2 * f2;
}
const NS_CURVE = Array.from({ length: 120 }, (_, i) => {
  const tau = (i + 1) * 0.25;
  return { tenor: +tau.toFixed(2), fitted: +nsYield(tau, NS_PARAMS).toFixed(4) };
});

// PCA loadings (will come from pca.py)
const PCA_LOADINGS = [
  { tenor: "0.5Y", pc1: 0.32, pc2: -0.52, pc3: 0.48 },
  { tenor: "1Y",   pc1: 0.34, pc2: -0.44, pc3: 0.28 },
  { tenor: "2Y",   pc1: 0.36, pc2: -0.26, pc3: -0.08 },
  { tenor: "3Y",   pc1: 0.36, pc2: -0.10, pc3: -0.28 },
  { tenor: "5Y",   pc1: 0.35, pc2:  0.14, pc3: -0.38 },
  { tenor: "7Y",   pc1: 0.34, pc2:  0.28, pc3: -0.24 },
  { tenor: "10Y",  pc1: 0.33, pc2:  0.40, pc3:  0.08 },
  { tenor: "20Y",  pc1: 0.31, pc2:  0.42, pc3:  0.38 },
  { tenor: "30Y",  pc1: 0.30, pc2:  0.43, pc3:  0.48 },
];

// Vasicek Monte Carlo paths (will come from vasicek.py)
function genPaths(n = 8, kappa = 0.3, theta = 0.05, sigma = 0.018, r0 = 0.03) {
  const paths = [];
  for (let p = 0; p < n; p++) {
    let r = r0 + (Math.random() - 0.5) * 0.005;
    const path = [];
    for (let t = 0; t <= 60; t++) {
      const dW = (Math.random() * 2 - 1) * Math.sqrt(1 / 12);
      r = Math.max(0, r + kappa * (theta - r) / 12 + sigma * dW);
      if (t % 2 === 0) path.push({ t: +(t / 12).toFixed(2), r: +(r * 100).toFixed(3) });
    }
    paths.push(path);
  }
  return paths;
}
const VASICEK_PATHS = genPaths();
const PATH_COLORS = ["#2A8FD4","#1AADAD","#4A8EC0","#2A9070","#5090D0","#1A9898","#3A80B8","#2A8060"];

/* ─── DESIGN TOKENS ───────────────────────────────────────────────────────── */
const T = {
  bg:      "#08090A",
  surf:    "#0D1117",
  surf2:   "#111820",
  border:  "#1A2030",
  border2: "#243040",
  text:    "#D0D8E4",
  muted:   "#48586A",
  dim:     "#1A2230",
  blue:    "#2A8FD4",
  blueLo:  "#0D2840",
  cyan:    "#1AADAD",
  cyanLo:  "#082828",
  green:   "#2A8060",
  red:     "#A03828",
  amber:   "#C07818",
  amberLo: "#301A04",
};

const mono  = "'IBM Plex Mono', monospace";
const serif = "'DM Serif Display', Georgia, serif";

/* ─── GLOBAL CSS ──────────────────────────────────────────────────────────── */
const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=DM+Serif+Display:ital@0;1&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  input[type=number] { -moz-appearance: textfield; }
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
  html, body { background: ${T.bg}; color: ${T.text}; }
  ::-webkit-scrollbar { width: 3px; background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.border2}; border-radius: 2px; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }

  .fade-1 { animation: fadeUp 0.3s 0.00s both; }
  .fade-2 { animation: fadeUp 0.3s 0.06s both; }
  .fade-3 { animation: fadeUp 0.3s 0.12s both; }
  .fade-4 { animation: fadeUp 0.3s 0.18s both; }

  .tab-btn { transition: color 0.12s, border-color 0.12s; }
  .tab-btn:hover { color: ${T.text} !important; }

  .row-h { transition: background 0.08s; }
  .row-h:hover { background: rgba(42,143,212,0.05) !important; }

  .live { animation: pulse 2.5s infinite; }

  .stub-badge {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid ${T.border2}; padding: 3px 10px;
    font-family: ${mono}; font-size: 8px; letter-spacing: 0.14em;
    text-transform: uppercase; color: ${T.amber};
  }
`;

/* ─── PRIMITIVES ──────────────────────────────────────────────────────────── */
function Label({ children, color, size = 9 }) {
  return (
    <div style={{ fontFamily: mono, fontSize: size, letterSpacing: "0.16em",
      textTransform: "uppercase", color: color || T.muted, marginBottom: 5 }}>
      {children}
    </div>
  );
}

function Divider({ my = 24 }) {
  return <div style={{ height: 1, background: T.border, margin: `${my}px 0` }} />;
}

function KpiBlock({ label, value, sub, accent }) {
  return (
    <div style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 20, paddingRight: 20 }}>
      <Label color={accent ? T.blue : T.muted}>{label}</Label>
      <div style={{ fontFamily: serif, fontSize: accent ? 44 : 22, color: accent ? T.blue : T.text,
        fontWeight: 400, lineHeight: 1, letterSpacing: "-0.01em" }}>
        {value}
      </div>
      {sub && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function StubBadge() {
  return (
    <span className="stub-badge">
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.amber, display: "inline-block" }} />
      hardcoded · live data wired on Day 4
    </span>
  );
}

function ChartTooltip({ active, payload, label, suffix = "" }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.surf, border: `1px solid ${T.border2}`, padding: "10px 14px", fontFamily: mono, fontSize: 11 }}>
      <div style={{ color: T.blue, marginBottom: 6 }}>{label}{suffix}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          <span style={{ color: T.muted }}>{p.name}: </span>{typeof p.value === "number" ? p.value.toFixed(3) : p.value}
        </div>
      ))}
    </div>
  );
}

/* ─── BOOTSTRAP TAB ───────────────────────────────────────────────────────── */
function BootstrapTab() {
  const spread_2s10s = SPOT_RATES.find(s => s.tenor === 10).spot - SPOT_RATES.find(s => s.tenor === 2).spot;
  const CustomDot = ({ cx, cy }) => (
    <circle cx={cx} cy={cy} r={3} fill={T.bg} stroke={T.blue} strokeWidth={1.5} />
  );

  return (
    <div className="fade-3" style={{ padding: "32px 44px", overflowY: "auto", height: "100%" }}>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", marginBottom: 32, borderLeft: "none" }}>
        <div>
          <Label color={T.blue}>2s10s spread</Label>
          <div style={{ fontFamily: serif, fontSize: 44, color: spread_2s10s >= 0 ? T.blue : T.red, lineHeight: 1 }}>
            {spread_2s10s >= 0 ? "+" : ""}{(spread_2s10s * 100).toFixed(0)} bps
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6 }}>
            {spread_2s10s >= 0 ? "normal · upward sloping" : "inverted · recession signal"}
          </div>
        </div>
        <KpiBlock label="2Y spot"  value={`${SPOT_RATES.find(s => s.tenor === 2).spot.toFixed(3)}%`} />
        <KpiBlock label="10Y spot" value={`${SPOT_RATES.find(s => s.tenor === 10).spot.toFixed(3)}%`} />
        <KpiBlock label="30Y spot" value={`${SPOT_RATES.find(s => s.tenor === 30).spot.toFixed(3)}%`} />
      </div>

      <div style={{ marginBottom: 20 }}><StubBadge /></div>

      <Divider />

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr", gap: 48 }}>

        {/* Curve chart */}
        <div>
          <Label>Par · spot · forward curves</Label>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, margin: "6px 0 18px" }}>
            <span style={{ color: T.blue }}>——</span>&ensp;Spot (zero)&emsp;
            <span style={{ color: T.cyan }}>——</span>&ensp;Par&emsp;
            <span style={{ color: T.muted }}>– –</span>&ensp;Forward&emsp;
            · bootstrapped recursively from par yields
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={SPOT_RATES} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="tenor" stroke={T.border}
                tick={{ fill: T.muted, fontSize: 9, fontFamily: mono }}
                tickFormatter={v => `${v}Y`} tickLine={false} axisLine={{ stroke: T.border }} />
              <YAxis stroke={T.border}
                tick={{ fill: T.muted, fontSize: 9, fontFamily: mono }}
                tickLine={false} axisLine={false} width={44}
                domain={[4.2, 5.8]} tickFormatter={v => `${v.toFixed(1)}%`} />
              <Tooltip content={<ChartTooltip suffix="Y" />} cursor={{ stroke: T.border }} />
              <Line type="monotone" dataKey="spot" stroke={T.blue}  strokeWidth={2}   dot={<CustomDot />} name="Spot" />
              <Line type="monotone" dataKey="par"  stroke={T.cyan}  strokeWidth={1.5} dot={false} name="Par" />
              <Line type="monotone" dataKey="fwd"  stroke={T.muted} strokeWidth={1.5} dot={false} strokeDasharray="5 4" name="Forward" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Spot rate table */}
        <div>
          <Label>Bootstrapped spot rates</Label>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, margin: "6px 0 14px" }}>
            recursive extraction · semi-annual compounding
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Tenor", "Par", "Spot", "Δ"].map((h, i) => (
                  <th key={h} style={{ padding: "0 0 8px", textAlign: i === 0 ? "left" : "right",
                    fontFamily: mono, fontWeight: 400, fontSize: 9, letterSpacing: "0.12em",
                    textTransform: "uppercase", color: T.muted, borderBottom: `1px solid ${T.border}` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SPOT_RATES.map(s => {
                const delta = s.spot - s.par;
                return (
                  <tr key={s.tenor} className="row-h">
                    <td style={{ padding: "7px 0", fontFamily: mono, fontSize: 11, color: T.muted, borderBottom: `1px solid ${T.border}` }}>{s.tenor}Y</td>
                    <td style={{ padding: "7px 0", fontFamily: mono, fontSize: 11, textAlign: "right", color: T.text, borderBottom: `1px solid ${T.border}` }}>{s.par.toFixed(2)}%</td>
                    <td style={{ padding: "7px 0", fontFamily: mono, fontSize: 11, textAlign: "right", color: T.blue, borderBottom: `1px solid ${T.border}` }}>{s.spot.toFixed(3)}%</td>
                    <td style={{ padding: "7px 0", fontFamily: mono, fontSize: 11, textAlign: "right",
                      color: delta >= 0 ? T.green : T.red, borderBottom: `1px solid ${T.border}` }}>
                      {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}bp
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* No-arbitrage note */}
          <div style={{ marginTop: 16, padding: "12px 14px", background: T.blueLo, border: `1px solid ${T.border2}` }}>
            <Label color={T.blue}>No-arbitrage condition</Label>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, lineHeight: 1.8 }}>
              (1+s₂)² = (1+s₁) × (1+f(1,2))<br />
              f(T₁,T₂) = [(1+s₂)^T₂/(1+s₁)^T₁]^(1/(T₂−T₁)) − 1
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── NELSON-SIEGEL TAB ───────────────────────────────────────────────────── */
function NelsonSiegelTab() {
  const [params, setParams] = useState(NS_PARAMS);

  const fitted = Array.from({ length: 120 }, (_, i) => {
    const tau = (i + 1) * 0.25;
    return { tenor: +tau.toFixed(2), fitted: +nsYield(tau, params).toFixed(4) };
  });

  const observed = SPOT_RATES.map(s => ({ tenor: s.tenor, observed: s.spot }));

  return (
    <div className="fade-3" style={{ padding: "32px 44px", overflowY: "auto", height: "100%" }}>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", marginBottom: 32 }}>
        <div>
          <Label color={T.blue}>β₀ — level</Label>
          <div style={{ fontFamily: serif, fontSize: 44, color: T.blue, lineHeight: 1 }}>{params.b0.toFixed(2)}%</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6 }}>long-run yield as τ→∞</div>
        </div>
        <KpiBlock label="β₁ — slope"     value={`${params.b1.toFixed(2)}%`} sub="short-end offset (β₀+β₁ = short rate)" />
        <KpiBlock label="β₂ — curvature" value={`${params.b2.toFixed(2)}%`} sub="medium-term hump / belly" />
        <KpiBlock label="λ — decay"       value={params.lambda.toFixed(2)}   sub={`hump peaks at ~${params.lambda.toFixed(1)}Y`} />
      </div>

      <div style={{ marginBottom: 20 }}><StubBadge /></div>

      <Divider />

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr", gap: 48 }}>

        {/* NS curve chart */}
        <div>
          <Label>Nelson-Siegel fitted curve</Label>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, margin: "6px 0 18px" }}>
            <span style={{ color: T.blue }}>——</span>&ensp;NS fitted&emsp;
            <span style={{ color: T.cyan }}>◆</span>&ensp;Observed spot rates&emsp;
            · y(τ) = β₀ + β₁·f₁(τ) + β₂·f₂(τ)
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="tenor" type="number" domain={[0, 30]} stroke={T.border}
                tick={{ fill: T.muted, fontSize: 9, fontFamily: mono }}
                tickFormatter={v => `${v}Y`} tickLine={false} axisLine={{ stroke: T.border }} />
              <YAxis stroke={T.border} tick={{ fill: T.muted, fontSize: 9, fontFamily: mono }}
                tickLine={false} axisLine={false} width={44} domain={[4.0, 5.8]}
                tickFormatter={v => `${v.toFixed(1)}%`} />
              <Tooltip content={<ChartTooltip suffix="Y" />} cursor={{ stroke: T.border }} />
              <Line data={fitted} type="monotone" dataKey="fitted"
                stroke={T.blue} strokeWidth={2} dot={false} name="NS fitted" />
              <Line data={observed} type="monotone" dataKey="observed"
                stroke={T.cyan} strokeWidth={0} dot={{ fill: T.cyan, r: 4, strokeWidth: 0 }} name="Observed" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Parameter sliders */}
        <div>
          <Label>Adjust parameters</Label>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, margin: "6px 0 18px" }}>
            drag to explore curve shapes · scipy.optimize fits these automatically
          </div>
          {[
            { key: "b0", label: "β₀ — level",      min: 2, max: 8,   step: 0.05 },
            { key: "b1", label: "β₁ — slope",      min: -4, max: 4,  step: 0.05 },
            { key: "b2", label: "β₂ — curvature",  min: -4, max: 4,  step: 0.05 },
            { key: "lambda", label: "λ — decay",   min: 0.5, max: 8, step: 0.1  },
          ].map(({ key, label, min, max, step }) => (
            <div key={key} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <Label>{label}</Label>
                <span style={{ fontFamily: mono, fontSize: 11, color: T.blue }}>{params[key].toFixed(2)}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={params[key]}
                onChange={e => setParams(p => ({ ...p, [key]: parseFloat(e.target.value) }))}
                style={{ width: "100%", accentColor: T.blue, cursor: "pointer" }} />
            </div>
          ))}

          <div style={{ padding: "12px 14px", background: T.blueLo, border: `1px solid ${T.border2}`, marginTop: 4 }}>
            <Label color={T.blue}>NS formula</Label>
            <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, lineHeight: 2.0 }}>
              y(τ) = β₀<br />
              &emsp;+ β₁·(1−e^(−τ/λ))/(τ/λ)<br />
              &emsp;+ β₂·[(1−e^(−τ/λ))/(τ/λ) − e^(−τ/λ)]
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── PCA TAB ─────────────────────────────────────────────────────────────── */
function PCATab() {
  const [activePC, setActivePC] = useState("pc1");

  const PC_META = {
    pc1: { label: "PC1 — Level",     color: T.blue,  variance: "84.2%", desc: "All maturities move together. Parallel shift. Driven by Fed hike/cut cycles." },
    pc2: { label: "PC2 — Slope",     color: T.cyan,  variance: "11.8%", desc: "Short and long ends diverge. Steepener/flattener. The 2s10s spread trade." },
    pc3: { label: "PC3 — Curvature", color: T.amber, variance: "2.9%",  desc: "Belly vs wings. Butterfly trade: long 5Y, short 2Y and 10Y." },
  };

  const pc = PC_META[activePC];

  return (
    <div className="fade-3" style={{ padding: "32px 44px", overflowY: "auto", height: "100%" }}>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", marginBottom: 32 }}>
        <div>
          <Label color={T.blue}>Variance explained</Label>
          <div style={{ fontFamily: serif, fontSize: 44, color: T.blue, lineHeight: 1 }}>99.0%</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6 }}>first 3 components</div>
        </div>
        {[["PC1 — level", "84.2%"], ["PC2 — slope", "11.8%"], ["PC3 — curvature", "2.9%"]].map(([l, v]) => (
          <KpiBlock key={l} label={l} value={v} />
        ))}
      </div>

      <div style={{ marginBottom: 20 }}><StubBadge /></div>

      <Divider />

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr", gap: 48 }}>

        {/* Loading chart */}
        <div>
          <Label>Principal component loadings</Label>
          <div style={{ display: "flex", gap: 0, margin: "12px 0 18px" }}>
            {Object.entries(PC_META).map(([id, meta]) => (
              <button key={id} className="tab-btn"
                onClick={() => setActivePC(id)}
                style={{ padding: "6px 16px", background: activePC === id ? meta.color + "22" : "transparent",
                  border: `1px solid ${activePC === id ? meta.color : T.border}`,
                  color: activePC === id ? meta.color : T.muted,
                  fontFamily: mono, fontSize: 9, letterSpacing: "0.12em",
                  textTransform: "uppercase", cursor: "pointer",
                  marginRight: 8, transition: "all 0.12s" }}>
                {meta.label}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={PCA_LOADINGS} margin={{ top: 4, right: 4, bottom: 4, left: 0 }} barSize={22}>
              <XAxis dataKey="tenor" stroke={T.border}
                tick={{ fill: T.muted, fontSize: 9, fontFamily: mono }}
                tickLine={false} axisLine={{ stroke: T.border }} />
              <YAxis stroke={T.border} tick={{ fill: T.muted, fontSize: 9, fontFamily: mono }}
                tickLine={false} axisLine={false} width={44} domain={[-0.6, 0.6]} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, padding: "8px 12px", fontFamily: mono, fontSize: 11 }}>
                  <div style={{ color: pc.color, marginBottom: 4 }}>{label}</div>
                  <div style={{ color: T.text }}>Loading: {payload[0]?.value?.toFixed(4)}</div>
                </div>
              ) : null} cursor={{ fill: "rgba(42,143,212,0.04)" }} />
              <ReferenceLine y={0} stroke={T.border2} />
              <Bar dataKey={activePC} radius={[2, 2, 0, 0]}>
                {PCA_LOADINGS.map((d, i) => (
                  <Cell key={i} fill={PCA_LOADINGS[i][activePC] >= 0 ? pc.color : pc.color + "66"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* PC explanations */}
        <div>
          <Label>Factor interpretation</Label>
          <div style={{ marginTop: 14 }}>
            {Object.entries(PC_META).map(([id, meta]) => (
              <div key={id} onClick={() => setActivePC(id)}
                style={{ padding: "14px", marginBottom: 10, border: `1px solid ${activePC === id ? meta.color : T.border}`,
                  background: activePC === id ? meta.color + "0A" : "transparent",
                  cursor: "pointer", transition: "all 0.12s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontFamily: mono, fontSize: 10, color: activePC === id ? meta.color : T.muted,
                    letterSpacing: "0.1em", textTransform: "uppercase" }}>{meta.label}</span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: meta.color }}>{meta.variance}</span>
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, lineHeight: 1.7 }}>{meta.desc}</div>
              </div>
            ))}

            <div style={{ padding: "12px 14px", background: T.blueLo, border: `1px solid ${T.border2}`, marginTop: 6 }}>
              <Label color={T.blue}>Eigendecomposition</Label>
              <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, lineHeight: 2.0 }}>
                Σ = V · Λ · Vᵀ<br />
                Σ = cov(Δyields) across maturities<br />
                Columns of V = loading vectors<br />
                Λ = diag(eigenvalues) = variance
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── VASICEK TAB ─────────────────────────────────────────────────────────── */
function VasicekTab() {
  const [kappa,  setKappa]  = useState(0.30);
  const [theta,  setTheta]  = useState(5.00);
  const [sigma,  setSigma]  = useState(1.80);
  const [r0,     setR0]     = useState(3.00);

  const paths = genPaths(8, kappa, theta / 100, sigma / 100, r0 / 100);
  const feller = 2 * kappa * (theta / 100) > Math.pow(sigma / 100, 2);
  const ert    = theta + (r0 - theta) * Math.exp(-kappa);

  return (
    <div className="fade-3" style={{ padding: "32px 44px", overflowY: "auto", height: "100%" }}>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", marginBottom: 32 }}>
        <div>
          <Label color={T.blue}>Long-run mean θ</Label>
          <div style={{ fontFamily: serif, fontSize: 44, color: T.blue, lineHeight: 1 }}>{theta.toFixed(2)}%</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6 }}>
            E[r<sub>∞</sub>] = θ · rates revert here
          </div>
        </div>
        <KpiBlock label="r₀ — today"      value={`${r0.toFixed(2)}%`}  sub="current short rate" />
        <KpiBlock label="E[r] at 1Y"      value={`${ert.toFixed(3)}%`} sub="θ + (r₀−θ)·e^(−κ)" />
        <KpiBlock label="Feller condition" value={feller ? "✓ holds" : "✗ fails"}
          sub={feller ? "positive rates guaranteed (CIR)" : "negative rates possible"} />
      </div>

      <Divider />

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr", gap: 48 }}>

        {/* Path chart */}
        <div>
          <Label>Monte Carlo short rate paths</Label>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, margin: "6px 0 18px" }}>
            dr = κ(θ−r)dt + σdW · 8 sample paths · mean reversion to&ensp;
            <span style={{ color: T.blue }}>θ = {theta.toFixed(2)}%</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" type="number" domain={[0, 5]} stroke={T.border}
                tick={{ fill: T.muted, fontSize: 9, fontFamily: mono }}
                tickFormatter={v => `${v}Y`} tickLine={false} axisLine={{ stroke: T.border }} />
              <YAxis stroke={T.border} tick={{ fill: T.muted, fontSize: 9, fontFamily: mono }}
                tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v.toFixed(1)}%`} />
              <ReferenceLine y={theta} stroke={T.blue} strokeDasharray="4 3" strokeOpacity={0.5} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, padding: "8px 12px", fontFamily: mono, fontSize: 11 }}>
                  <div style={{ color: T.blue, marginBottom: 4 }}>t = {parseFloat(label).toFixed(2)}Y</div>
                  {payload.slice(0, 4).map((p, i) => (
                    <div key={i} style={{ color: p.color }}>{p.value?.toFixed(3)}%</div>
                  ))}
                </div>
              ) : null} cursor={{ stroke: T.border }} />
              {paths.map((path, i) => (
                <Line key={i} data={path} dataKey="r" type="monotone"
                  stroke={PATH_COLORS[i]} strokeWidth={1} dot={false}
                  strokeOpacity={0.65} name={`Path ${i + 1}`} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Parameter controls */}
        <div>
          <Label>Model parameters</Label>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, margin: "6px 0 18px" }}>
            adjust to recalibrate paths in real time
          </div>

          {[
            { label: "κ — mean reversion speed", value: kappa,  set: setKappa,  min: 0.01, max: 2.0,  step: 0.01, fmt: v => v.toFixed(2) },
            { label: "θ — long-run mean (%)",    value: theta,  set: setTheta,  min: 0.5,  max: 10.0, step: 0.1,  fmt: v => v.toFixed(2) + "%" },
            { label: "σ — volatility (%)",       value: sigma,  set: setSigma,  min: 0.1,  max: 5.0,  step: 0.05, fmt: v => v.toFixed(2) + "%" },
            { label: "r₀ — initial rate (%)",    value: r0,     set: setR0,     min: 0.1,  max: 10.0, step: 0.1,  fmt: v => v.toFixed(2) + "%" },
          ].map(({ label, value, set, min, max, step, fmt }) => (
            <div key={label} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <Label>{label}</Label>
                <span style={{ fontFamily: mono, fontSize: 11, color: T.blue }}>{fmt(value)}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={value}
                onChange={e => set(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: T.blue, cursor: "pointer" }} />
            </div>
          ))}

          <div style={{ padding: "12px 14px", background: feller ? T.blueLo : T.amberLo,
            border: `1px solid ${feller ? T.border2 : T.amber}`, marginTop: 4, transition: "all 0.2s" }}>
            <Label color={feller ? T.blue : T.amber}>
              {feller ? "Feller condition satisfied" : "Feller condition violated"}
            </Label>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, lineHeight: 1.8 }}>
              2κθ = {(2 * kappa * theta / 100).toFixed(4)}<br />
              σ² = {Math.pow(sigma / 100, 2).toFixed(6)}<br />
              {feller ? "CIR: positive rates guaranteed" : "Vasicek: negative rates possible"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN ────────────────────────────────────────────────────────────────── */
export default function App() {
  const [tab, setTab] = useState("bootstrap");

  const TABS = [
    { id: "bootstrap", l: "Bootstrapper" },
    { id: "ns",        l: "Nelson-Siegel" },
    { id: "pca",       l: "PCA" },
    { id: "vasicek",   l: "Vasicek / CIR" },
  ];

  const spread = SPOT_RATES.find(s => s.tenor === 10).spot - SPOT_RATES.find(s => s.tenor === 2).spot;

  return (
    <div style={{ background: T.bg, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{css}</style>

      {/* ── HEADER ── */}
      <div className="fade-1" style={{ borderBottom: `1px solid ${T.border}`, padding: "0 40px",
        height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 2, height: 18, background: T.blue }} />
          <span style={{ fontFamily: serif, fontSize: 15, color: T.text }}>Yield Curve Suite</span>
          <div style={{ width: 1, height: 14, background: T.border }} />
          <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.18em",
            textTransform: "uppercase", color: T.muted }}>Project 2 · Fixed Income</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: T.muted }}>
            {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric" }).toUpperCase()}
          </span>
          <div style={{ width: 1, height: 12, background: T.border }} />
          <span style={{ fontFamily: mono, fontSize: 9, color: T.muted }}>github.com/aharode/yield-curve</span>
        </div>
      </div>

      {/* ── STATUS BAR ── */}
      <div className="fade-2" style={{ borderBottom: `1px solid ${T.border}`, padding: "0 40px",
        height: 30, display: "flex", alignItems: "center", background: T.surf, flexShrink: 0 }}>
        {[
          ["2Y",    `${SPOT_RATES.find(s=>s.tenor===2).spot.toFixed(2)}%`],
          ["5Y",    `${SPOT_RATES.find(s=>s.tenor===5).spot.toFixed(2)}%`],
          ["10Y",   `${SPOT_RATES.find(s=>s.tenor===10).spot.toFixed(2)}%`],
          ["30Y",   `${SPOT_RATES.find(s=>s.tenor===30).spot.toFixed(2)}%`],
          ["2s10s", `${spread >= 0 ? "+" : ""}${(spread * 100).toFixed(0)}bp`],
          ["Source","US Treasury · bootstrapped"],
          ["Model", "Nelson-Siegel"],
          ["λ",     "2.40"],
        ].map(([k, v], i) => (
          <div key={k} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && <div style={{ width: 1, height: 12, background: T.border, margin: "0 14px" }} />}
            <span style={{ fontFamily: mono, fontSize: 9, color: T.muted, marginRight: 6,
              letterSpacing: "0.1em", textTransform: "uppercase" }}>{k}</span>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.blue, fontWeight: 500 }}>{v}</span>
          </div>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div className="live" style={{ width: 5, height: 5, borderRadius: "50%", background: T.amber }} />
          <span style={{ fontFamily: mono, fontSize: 8, color: T.amber, letterSpacing: "0.12em" }}>STUB DATA</span>
        </div>
      </div>

      {/* ── TAB BAR ── */}
      <div className="fade-2" style={{ borderBottom: `1px solid ${T.border}`, display: "flex",
        paddingLeft: 40, flexShrink: 0 }}>
        {TABS.map(({ id, l }) => (
          <button key={id} className="tab-btn" onClick={() => setTab(id)} style={{
            padding: "13px 0", marginRight: 28, marginBottom: -1,
            background: "transparent", border: "none",
            borderBottom: `1px solid ${tab === id ? T.blue : "transparent"}`,
            color: tab === id ? T.blue : T.muted,
            fontFamily: mono, fontSize: 9, letterSpacing: "0.16em",
            textTransform: "uppercase", cursor: "pointer",
          }}>
            {l}
          </button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {tab === "bootstrap" && <BootstrapTab />}
        {tab === "ns"        && <NelsonSiegelTab />}
        {tab === "pca"       && <PCATab />}
        {tab === "vasicek"   && <VasicekTab />}
      </div>
    </div>
  );
}
