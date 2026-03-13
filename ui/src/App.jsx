import { useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

/* ─── MATH ENGINE ─────────────────────────────────────────────────────────── */
function calcPrice(face, couponRate, periods, freq, ytm) {
  const C = (couponRate / freq) * face;
  const y = ytm / freq;
  const N = periods * freq;
  if (Math.abs(y) < 1e-12) return C * N + face;
  return C * (1 - Math.pow(1 + y, -N)) / y + face / Math.pow(1 + y, N);
}

function solveYTM(face, couponRate, periods, freq, price) {
  let y = couponRate;
  for (let i = 0; i < 500; i++) {
    const p  = calcPrice(face, couponRate, periods, freq, y);
    const dp = (calcPrice(face, couponRate, periods, freq, y + 1e-6) -
                calcPrice(face, couponRate, periods, freq, y - 1e-6)) / 2e-6;
    if (Math.abs(dp) < 1e-14) break;
    const delta = (p - price) / dp;
    y -= delta;
    if (Math.abs(delta) < 1e-10) break;
  }
  return y;
}

function buildCashFlows(face, couponRate, periods, freq, ytm) {
  const C = (couponRate / freq) * face;
  const y = ytm / freq;
  const N = periods * freq;
  const P = calcPrice(face, couponRate, periods, freq, ytm);
  return Array.from({ length: N }, (_, i) => {
    const t  = i + 1;
    const cf = t < N ? C : C + face;
    const pv = cf / Math.pow(1 + y, t);
    const w  = pv / P;
    return { t, tYr: t / freq, cf, pv, w, durContrib: (t / freq) * w };
  });
}

function macaulayDuration(cfRows)           { return cfRows.reduce((s, r) => s + r.durContrib, 0); }
function modifiedDuration(mac, ytm, freq)   { return mac / (1 + ytm / freq); }
function dv01PerBond(modDur, price)         { return modDur * price * 0.0001; }
function positionDv01(dv01, notional, face) { return dv01 * (notional / face); }

function buildScenarios(face, cr, periods, freq, ytm, price, modDur) {
  return [-200, -100, -50, -25, 25, 50, 100, 200].map(bp => {
    const dy     = bp / 10000;
    const newYTM = Math.max(0.0001, ytm + dy);
    const exactP = calcPrice(face, cr, periods, freq, newYTM);
    const approxP= price * (1 - modDur * dy);
    return { bp, label: `${bp > 0 ? "+" : ""}${bp}`, exact: exactP - price, approx: approxP - price, exactP, newYTM };
  });
}

/* ─── TOKENS ──────────────────────────────────────────────────────────────── */
const A  = "#F0A500";
const G  = "#4CAF92";
const R  = "#E05A4E";
const BG     = "#111110";
const BORDER = "#222220";
const TEXT   = "#EEECEA";
const MUTED  = "#666460";
const DIM    = "#3A3A38";
const FAINT  = "#2A2A28";

/* ─── PRIMITIVES ──────────────────────────────────────────────────────────── */
function Label({ children, amber }) {
  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 10,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: amber ? A : MUTED,
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, step, min, max }) {
  const [focused, setFocused] = useState(false);
  return (
    <input type="number" value={value} step={step} min={min} max={max}
      onChange={e => onChange(e.target.value)}
      style={{ width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${focused ? A : BORDER}`, color: TEXT, fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, padding: "4px 0 7px", outline: "none", transition: "border-color 0.15s", boxSizing: "border-box" }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function FreqToggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 20 }}>
      {[{ v: 1, l: "Annual" }, { v: 2, l: "Semi-annual" }].map(({ v, l }) => (
        <label key={v} onClick={() => onChange(v)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: value === v ? A : MUTED, transition: "color 0.15s" }}>
          <div style={{ width: 13, height: 13, border: `1px solid ${value === v ? A : DIM}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "border-color 0.15s" }}>
            {value === v && <div style={{ width: 5, height: 5, borderRadius: "50%", background: A }} />}
          </div>
          {l}
        </label>
      ))}
    </div>
  );
}

function ModeToggle({ value, onChange }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${BORDER}`, marginBottom: 32 }}>
      {[{ id: "price", l: "YTM → Price" }, { id: "ytm", l: "Price → YTM" }].map(({ id, l }) => (
        <button key={id} onClick={() => onChange(id)} style={{ padding: "8px 18px", background: value === id ? A : "transparent", color: value === id ? BG : MUTED, border: "none", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", transition: "all 0.15s", fontWeight: value === id ? 600 : 400 }}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: BORDER, margin: "24px 0" }} />;
}

/* ─── TOOLTIPS ────────────────────────────────────────────────────────────── */
const DurTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1A1A18", border: `1px solid ${BORDER}`, padding: "8px 12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      <div style={{ color: A, marginBottom: 4 }}>t = {label}y</div>
      <div style={{ color: TEXT }}>Contribution: {payload[0]?.value?.toFixed(4)} yr</div>
    </div>
  );
};

const ScenarioTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1A1A18", border: `1px solid ${BORDER}`, padding: "8px 12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      <div style={{ color: A, marginBottom: 4 }}>{label} bps</div>
      <div style={{ color: TEXT }}>Exact: {payload[0]?.value > 0 ? "+" : ""}{payload[0]?.value?.toFixed(4)}</div>
      <div style={{ color: MUTED }}>Approx: {payload[1]?.value > 0 ? "+" : ""}{payload[1]?.value?.toFixed(4)}</div>
    </div>
  );
};

/* ─── PRICING TAB ─────────────────────────────────────────────────────────── */
function PricingTab({ face, cr, periods, freq, ytm, mode, daysSince, daysInPer }) {
  const dirty   = calcPrice(face, cr, periods, freq, ytm);
  const accrued = (cr / freq) * face * (daysSince / daysInPer);
  const clean   = dirty - accrued;
  const cfRows  = buildCashFlows(face, cr, periods, freq, ytm);
  const macDur  = macaulayDuration(cfRows);
  const maxPV   = Math.max(...cfRows.map(r => r.pv));

  const parLabel = dirty > face * 1.001 ? "premium" : dirty < face * 0.999 ? "discount" : "par";
  const parColor = dirty > face * 1.001 ? G : dirty < face * 0.999 ? R : TEXT;
  const parDiff  = ((dirty / face - 1) * 100).toFixed(3);

  return (
    <div style={{ padding: "36px 48px", overflowY: "auto" }}>

      {/* Primary */}
      <div style={{ marginBottom: 36 }}>
        <Label amber>{mode === "price" ? "Dirty price" : "Solved YTM"}</Label>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 40, fontWeight: 300, color: A, letterSpacing: "-0.04em", lineHeight: 1 }}>
          {mode === "price" ? `$${dirty.toFixed(4)}` : `${(ytm * 100).toFixed(6)}%`}
        </div>
      </div>

      {/* Secondary trio */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", marginBottom: 8 }}>
        {[["Clean price", `$${clean.toFixed(4)}`], ["Accrued interest", `$${accrued.toFixed(4)}`], ["Macaulay duration", `${macDur.toFixed(4)} yr`]].map(([l, v], i) => (
          <div key={l} style={{ borderLeft: i > 0 ? `1px solid ${BORDER}` : "none", paddingLeft: i > 0 ? 28 : 0, paddingRight: 28 }}>
            <Label>{l}</Label>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, color: TEXT, letterSpacing: "-0.01em" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Par line */}
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, marginBottom: 36, marginTop: 12 }}>
        Trading at <span style={{ color: parColor }}>{parLabel}</span>
        <span style={{ color: DIM }}> · </span>
        {parDiff}% {dirty >= face ? "above" : "below"} par
      </div>

      <Divider />

      {/* Cash flow table */}
      <Label>Cash flows</Label>
      <div style={{ marginTop: 12 }} />
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Period", "Time", "Cash flow", "PV", "Weight", "Dur. contrib"].map((h, i) => (
              <th key={h} style={{ padding: "0 0 10px", textAlign: i === 0 ? "left" : "right", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cfRows.map((row, i) => {
            const isFinal = i === cfRows.length - 1;
            return (
              <tr key={row.t} onMouseEnter={e => e.currentTarget.style.background = "#FFFFFF04"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: MUTED, borderBottom: `1px solid ${BORDER}` }}>{row.t}</td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: MUTED, borderBottom: `1px solid ${BORDER}` }}>{row.tYr.toFixed(1)}y</td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: isFinal ? A : TEXT, fontWeight: isFinal ? 500 : 400, borderBottom: `1px solid ${BORDER}` }}>{row.cf.toFixed(2)}</td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: TEXT, borderBottom: `1px solid ${BORDER}` }}>{row.pv.toFixed(4)}</td>
                <td style={{ padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                    <div style={{ width: Math.max(2, (row.pv / maxPV) * 60), height: 2, background: isFinal ? A : DIM, transition: "width 0.3s" }} />
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, minWidth: 38, textAlign: "right" }}>{(row.w * 100).toFixed(1)}%</span>
                  </div>
                </td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: MUTED, borderBottom: `1px solid ${BORDER}` }}>{row.durContrib.toFixed(4)}</td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={5} style={{ padding: "12px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED }}>Macaulay duration</td>
            <td style={{ padding: "12px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: A, fontWeight: 500 }}>{macDur.toFixed(4)} yr</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ─── RISK TAB ────────────────────────────────────────────────────────────── */
function RiskTab({ face, cr, periods, freq, ytm, notional }) {
  const price     = calcPrice(face, cr, periods, freq, ytm);
  const cfRows    = buildCashFlows(face, cr, periods, freq, ytm);
  const macDur    = macaulayDuration(cfRows);
  const modDur    = modifiedDuration(macDur, ytm, freq);
  const dv01Bond  = dv01PerBond(modDur, price);
  const posDv01   = positionDv01(dv01Bond, notional, face);
  const scenarios = buildScenarios(face, cr, periods, freq, ytm, price, modDur);

  const durData = cfRows.map(r => ({
    label: r.tYr.toFixed(1),
    contrib: +r.durContrib.toFixed(5),
    isFinal: r.t === cfRows.length,
  }));

  return (
    <div style={{ padding: "36px 48px", overflowY: "auto" }}>

      {/* Primary — Modified Duration */}
      <div style={{ marginBottom: 36 }}>
        <Label amber>Modified duration</Label>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 40, fontWeight: 300, color: A, letterSpacing: "-0.04em", lineHeight: 1 }}>
          {modDur.toFixed(4)}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, marginTop: 8 }}>
          D_mac / (1 + {(ytm / freq * 100).toFixed(2)}%) = {macDur.toFixed(4)} / {(1 + ytm / freq).toFixed(4)}
        </div>
      </div>

      {/* Secondary trio */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", marginBottom: 36 }}>
        {[
          ["Macaulay duration", `${macDur.toFixed(4)} yr`],
          ["DV01 — per bond",   `$${dv01Bond.toFixed(4)}`],
          [`DV01 — $${(notional/1e6).toFixed(0)}M position`, `$${posDv01.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`],
        ].map(([l, v], i) => (
          <div key={l} style={{ borderLeft: i > 0 ? `1px solid ${BORDER}` : "none", paddingLeft: i > 0 ? 28 : 0, paddingRight: 28 }}>
            <Label>{l}</Label>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, color: TEXT, letterSpacing: "-0.01em" }}>{v}</div>
          </div>
        ))}
      </div>

      <Divider />

      {/* Duration contribution chart */}
      <Label>Duration contribution by period</Label>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, margin: "8px 0 20px" }}>
        Each bar = <span style={{ color: A }}>t × PV(CFₜ) / P</span>
        <span style={{ color: DIM }}> · </span>
        bars sum to <span style={{ color: TEXT }}>{macDur.toFixed(4)} yr</span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={durData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }} barSize={periods <= 5 ? 28 : 14}>
          <XAxis dataKey="label" stroke={BORDER} tick={{ fill: MUTED, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }} tickLine={false} axisLine={{ stroke: BORDER }} />
          <YAxis stroke={BORDER} tick={{ fill: MUTED, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<DurTooltip />} cursor={{ fill: "rgba(240,165,0,0.03)" }} />
          <Bar dataKey="contrib" radius={[2, 2, 0, 0]}>
            {durData.map((d, i) => <Cell key={i} fill={d.isFinal ? A : DIM} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <Divider />

      {/* Scenario chart */}
      <Label>Rate shock scenarios</Label>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, margin: "8px 0 20px" }}>
        <span style={{ color: A }}>Solid</span> = exact reprice
        <span style={{ color: DIM }}> · </span>
        <span style={{ color: MUTED }}>Faded</span> = duration approx
        <span style={{ color: DIM }}> · </span>
        gap = convexity benefit <span style={{ color: DIM }}>(Day 3)</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={scenarios} margin={{ top: 4, right: 4, bottom: 4, left: 0 }} barGap={3} barSize={16}>
          <XAxis dataKey="label" stroke={BORDER} tick={{ fill: MUTED, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }} tickLine={false} axisLine={{ stroke: BORDER }} />
          <YAxis stroke={BORDER} tick={{ fill: MUTED, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }} tickLine={false} axisLine={false} width={52} tickFormatter={v => v.toFixed(1)} />
          <Tooltip content={<ScenarioTooltip />} cursor={{ fill: "rgba(240,165,0,0.03)" }} />
          <ReferenceLine y={0} stroke={BORDER} />
          <Bar dataKey="exact" radius={[2, 2, 0, 0]}>
            {scenarios.map((s, i) => <Cell key={i} fill={s.exact >= 0 ? A : R} />)}
          </Bar>
          <Bar dataKey="approx" radius={[2, 2, 0, 0]}>
            {scenarios.map((s, i) => <Cell key={i} fill={s.approx >= 0 ? A + "33" : R + "33"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Scenario table */}
      <div style={{ marginTop: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Shock", "New YTM", "New price", "Δ Price", "Δ Price (approx)", "Error"].map((h, i) => (
                <th key={h} style={{ padding: "0 0 10px", textAlign: i === 0 ? "left" : "right", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios.map(s => (
              <tr key={s.bp} onMouseEnter={e => e.currentTarget.style.background = "#FFFFFF04"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: TEXT, borderBottom: `1px solid ${BORDER}` }}>{s.label}</td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: MUTED, borderBottom: `1px solid ${BORDER}` }}>{(s.newYTM * 100).toFixed(3)}%</td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: TEXT, borderBottom: `1px solid ${BORDER}` }}>{s.exactP.toFixed(4)}</td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: s.exact >= 0 ? A : R, borderBottom: `1px solid ${BORDER}` }}>{s.exact >= 0 ? "+" : ""}{s.exact.toFixed(4)}</td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: MUTED, borderBottom: `1px solid ${BORDER}` }}>{s.approx >= 0 ? "+" : ""}{s.approx.toFixed(4)}</td>
                <td style={{ padding: "8px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, textAlign: "right", color: DIM, borderBottom: `1px solid ${BORDER}` }}>{(s.exact - s.approx).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, marginTop: 10 }}>
          Error = exact − duration approx. Always positive for option-free bonds — convexity benefit covered on Day 3.
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN ────────────────────────────────────────────────────────────────── */
export default function App() {
  const [face,       setFace]       = useState(1000);
  const [couponPct,  setCouponPct]  = useState(5.0);
  const [periods,    setPeriods]    = useState(5);
  const [freq,       setFreq]       = useState(2);
  const [ytmPct,     setYtmPct]     = useState(6.0);
  const [priceInput, setPriceInput] = useState("");
  const [daysSince,  setDaysSince]  = useState(30);
  const [daysInPer,  setDaysInPer]  = useState(180);
  const [mode,       setMode]       = useState("price");
  const [notional,   setNotional]   = useState(10000000);
  const [activeTab,  setActiveTab]  = useState("pricing");

  const cr  = couponPct / 100;
  const ytm = mode === "price"
    ? ytmPct / 100
    : (() => { const p = parseFloat(priceInput); return isNaN(p) || p <= 0 ? cr : solveYTM(face, cr, periods, freq, p); })();

  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        input[type=number] { -moz-appearance: textfield; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
        body { background: ${BG}; }
        @keyframes up { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* HEADER */}
      <div style={{ borderBottom: `1px solid ${BORDER}`, padding: "0 40px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 2, height: 16, background: A }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: TEXT }}>Bond Analytics</span>
          <div style={{ width: 1, height: 14, background: BORDER }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.16em", color: MUTED }}>Project 1 · Day 2</span>
        </div>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.12em", color: MUTED }}>
          {new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).toUpperCase()}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", minHeight: "calc(100vh - 52px)" }}>

        {/* SIDEBAR */}
        <div style={{ borderRight: `1px solid ${BORDER}`, padding: "32px 28px", overflowY: "auto" }}>
          <ModeToggle value={mode} onChange={m => {
            setMode(m);
            if (m === "ytm" && !priceInput) setPriceInput(calcPrice(face, cr, periods, freq, ytmPct / 100).toFixed(4));
          }} />

          <Field label="Face value ($)"><NumInput value={face} onChange={v => setFace(parseFloat(v) || 0)} step={100} min={100} /></Field>
          <Field label="Coupon rate (% p.a.)"><NumInput value={couponPct} onChange={v => setCouponPct(parseFloat(v) || 0)} step={0.25} min={0} max={30} /></Field>
          <Field label="Years to maturity"><NumInput value={periods} onChange={v => setPeriods(parseInt(v) || 1)} step={1} min={1} max={50} /></Field>
          <Field label="Frequency"><FreqToggle value={freq} onChange={setFreq} /></Field>
          {mode === "price"
            ? <Field label="YTM (% p.a.)"><NumInput value={ytmPct} onChange={v => setYtmPct(parseFloat(v) || 0)} step={0.1} min={0.01} /></Field>
            : <Field label="Market price ($)"><NumInput value={priceInput} onChange={setPriceInput} step={0.01} min={0.01} /></Field>
          }

          <Divider />

          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: A, marginBottom: 14 }}>Accrued interest</div>
          <Field label="Days since last coupon"><NumInput value={daysSince} onChange={v => setDaysSince(parseInt(v) || 0)} step={1} min={0} /></Field>
          <Field label="Days in coupon period"><NumInput value={daysInPer} onChange={v => setDaysInPer(parseInt(v) || 1)} step={1} min={1} /></Field>

          <Divider />

          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: A, marginBottom: 14 }}>Position size</div>
          <Field label="Notional face value ($)"><NumInput value={notional} onChange={v => setNotional(parseFloat(v) || 0)} step={1000000} min={0} /></Field>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, marginTop: -14, marginBottom: 20 }}>
            ${(notional / 1e6).toFixed(0)}M · {(notional / face).toLocaleString()} bonds
          </div>

          <Divider />

          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: DIM, lineHeight: 2.4 }}>
            <div>D_mac = Σ t · PV(CFₜ) / P</div>
            <div>D_mod = D_mac / (1 + y/freq)</div>
            <div>DV01  = D_mod · P · 0.0001</div>
            <div>Pos   = DV01 · (N / F)</div>
          </div>
        </div>

        {/* MAIN */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Tabs */}
          <div style={{ borderBottom: `1px solid ${BORDER}`, display: "flex", paddingLeft: 48 }}>
            {[{ id: "pricing", l: "Pricing" }, { id: "risk", l: "Risk & Duration" }].map(({ id, l }) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                padding: "16px 0",
                marginRight: 32,
                marginBottom: -1,
                background: "transparent",
                border: "none",
                borderBottom: `1px solid ${activeTab === id ? A : "transparent"}`,
                color: activeTab === id ? A : MUTED,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "all 0.15s",
              }}>
                {l}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {activeTab === "pricing"
              ? <PricingTab face={face} cr={cr} periods={periods} freq={freq} ytm={ytm} mode={mode} daysSince={daysSince} daysInPer={daysInPer} />
              : <RiskTab face={face} cr={cr} periods={periods} freq={freq} ytm={ytm} notional={notional} />
            }
          </div>
        </div>
      </div>
    </div>
  );
}
