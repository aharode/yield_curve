import { useState, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Cell,
} from "recharts";

/* ─── DESIGN TOKENS ───────────────────────────────────────────────────────── */
const T = {
  bg:      "#08090A",
  surf:    "#0D1117",
  surf2:   "#111820",
  border:  "#1A2030",
  border2: "#243040",
  text:    "#D0D8E4",
  muted:   "#48586A",
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

/* ─── TREASURY FETCH ──────────────────────────────────────────────────────── */
const TENOR_MAP = {
  BC_1MONTH: 1/12, BC_3MONTH: 0.25, BC_6MONTH: 0.5,
  BC_1YEAR: 1, BC_2YEAR: 2, BC_3YEAR: 3, BC_5YEAR: 5,
  BC_7YEAR: 7, BC_10YEAR: 10, BC_20YEAR: 20, BC_30YEAR: 30,
};

// Latest daily curve. Early in a month the current month's feed can be empty,
// so fall back to the previous months before giving up.
async function fetchTreasuryYields() {
  const now = new Date();
  for (let back = 0; back < 3; back++) {
    const d     = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    const url   = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${month}`;
    const res   = await fetch(url);
    const doc   = new DOMParser().parseFromString(await res.text(), "application/xml");
    const entries = doc.querySelectorAll("entry");
    if (!entries.length) continue;
    const entry   = entries[entries.length - 1];
    const content = entry.querySelector("content") || entry;
    const date    = content.querySelector("NEW_DATE")?.textContent?.slice(0, 10) || "unknown";
    const yields  = {};
    for (const [field, tenor] of Object.entries(TENOR_MAP)) {
      const el  = content.querySelector(field);
      const val = el ? parseFloat(el.textContent) : null;
      if (val !== null && !isNaN(val)) yields[tenor] = val;
    }
    return { date, yields };
  }
  throw new Error("No Treasury entries in the last 3 months");
}

/* ─── BOOTSTRAP (JS port of bootstrapper.py) ─────────────────────────────── */
function getInterpolatedSpot(spots, tenor) {
  if (spots[tenor] !== undefined) return spots[tenor];
  const keys = Object.keys(spots).map(Number).sort((a, b) => a - b);
  if (!keys.length) return 0;
  if (tenor <= keys[0]) return spots[keys[0]];
  if (tenor >= keys[keys.length - 1]) return spots[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    if (tenor >= keys[i] && tenor <= keys[i + 1]) {
      const t = (tenor - keys[i]) / (keys[i + 1] - keys[i]);
      return spots[keys[i]] + t * (spots[keys[i + 1]] - spots[keys[i]]);
    }
  }
  return spots[keys[keys.length - 1]];
}

// Price per unit face of a par coupon bond off a (partial) spot curve in percent
function parBondPrice(spots, T_n, c, N) {
  let pv = 0;
  for (let k = 1; k < N; k++) {
    pv += (c / 2) / Math.pow(1 + getInterpolatedSpot(spots, k / 2) / 200, k);
  }
  return pv + (1 + c / 2) / Math.pow(1 + spots[T_n] / 200, N);
}

// Bills (<= 6M) take spot = par. For coupon bonds, solve for the spot rate that
// prices the par bond at 1, with coupon dates past the last known tenor
// interpolated toward the unknown spot (bisection; price falls as the rate rises).
function bootstrapSpots(parYields) {
  const spots = {};
  const sorted = [...parYields].sort((a, b) => a[0] - b[0]);
  for (const [T_n, par] of sorted) {
    const N = Math.round(T_n * 2);
    const c = par / 100;
    if (N <= 1) { spots[T_n] = par; continue; }
    let lo = -50, hi = 100;  // percent
    for (let iter = 0; iter < 200 && hi - lo > 1e-12; iter++) {
      const mid = (lo + hi) / 2;
      if (parBondPrice({ ...spots, [T_n]: mid }, T_n, c, N) > 1) lo = mid; else hi = mid;
    }
    spots[T_n] = (lo + hi) / 2;
  }
  return spots;
}

function spotsToForwards(spots) {
  const keys = Object.keys(spots).map(Number).sort((a, b) => a - b);
  const fwds = {};
  fwds[keys[0]] = spots[keys[0]];
  for (let i = 1; i < keys.length; i++) {
    const T1 = keys[i - 1], T2 = keys[i];
    const s1 = spots[T1] / 100, s2 = spots[T2] / 100;
    const n1 = T1 * 2, n2 = T2 * 2, dn = n2 - n1;
    const fwd = 2 * (Math.pow(Math.pow(1 + s2/2, n2) / Math.pow(1 + s1/2, n1), 1/dn) - 1) * 100;
    fwds[T2] = isFinite(fwd) ? fwd : spots[T2];
  }
  return fwds;
}

/* ─── NELSON-SIEGEL (JS port) ─────────────────────────────────────────────── */
function nsYield(tau, b0, b1, b2, lam) {
  if (tau <= 0) return b0 + b1;
  const x = tau / lam, e = Math.exp(-x);
  const f1 = (1 - e) / x, f2 = f1 - e;
  return b0 + b1 * f1 + b2 * f2;
}

function invert3x3(M) {
  const A = M.map((row, i) => [...row, ...Array.from({ length: 3 }, (_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < 3; col++) {
    const pivot = [col, col+1, col+2].reduce((p, r) =>
      Math.abs(A[r]?.[col] ?? 0) > Math.abs(A[p][col]) ? r : p, col);
    [A[col], A[pivot]] = [A[pivot], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) return null;
    const div = A[col][col];
    A[col] = A[col].map(v => v / div);
    for (let row = 0; row < 3; row++) {
      if (row !== col) { const f = A[row][col]; A[row] = A[row].map((v, j) => v - f * A[col][j]); }
    }
  }
  return A.map(row => row.slice(3));
}

function fitNS(tenors, yields) {
  let best = null, bestSSE = Infinity;
  const lamGrid = Array.from({ length: 40 }, (_, i) => 0.1 * Math.pow(100, i/39));
  for (const lam of lamGrid) {
    const X = tenors.map(tau => {
      if (tau <= 0) return [1, 1, 0];
      const x = tau/lam, e = Math.exp(-x), f1 = (1-e)/x, f2 = f1-e;
      return [1, f1, f2];
    });
    const n = tenors.length, k = 3;
    const XtX = Array.from({length:k}, (_,r) => Array.from({length:k}, (_,c) => X.reduce((s,row)=>s+row[r]*row[c],0)));
    const Xty = Array.from({length:k}, (_,r) => X.reduce((s,row,i)=>s+row[r]*yields[i],0));
    const inv = invert3x3(XtX);
    if (!inv) continue;
    const [b0,b1,b2] = Array.from({length:k}, (_,r) => inv[r].reduce((s,v,c)=>s+v*Xty[c],0));
    const sse = tenors.reduce((s,t,i)=>s+(yields[i]-nsYield(t,b0,b1,b2,lam))**2, 0);
    if (sse < bestSSE) { bestSSE = sse; best = {b0,b1,b2,lam}; }
  }
  return best || {b0:4.5,b1:-0.3,b2:0.5,lam:2.5};
}

/* ─── PCA ─────────────────────────────────────────────────────────────────── */
// Computed offline from real Treasury history by data/build_dashboard_data.py (src/pca.py)
// and served as a static file, so the browser only displays the result.
const PCA_URL = "/pca.json";
const tenorLabel = t => t < 1 ? `${Math.round(t * 12)}M` : `${t}Y`;
const fmtUsd = v => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString(undefined, {maximumFractionDigits: 0})}`;

// Vasicek parameters calibrated to the 3M T-bill by data/build_dashboard_data.py
const VASICEK_URL = "/vasicek.json";
const usableCalibration = c => c && c.mean_reverting && c.theta > 0 && c.theta < 0.15 && c.kappa < 5;

/* ─── VASICEK ─────────────────────────────────────────────────────────────── */
function boxMuller() {
  return Math.sqrt(-2*Math.log(Math.random()))*Math.cos(2*Math.PI*Math.random());
}
function genPaths(n=8, kappa=0.3, theta=0.05, sigma=0.018, r0=0.03) {
  return Array.from({length:n}, () => {
    let r = r0 + (Math.random()-0.5)*0.002;
    return Array.from({length:31}, (_,t) => {
      r = r + kappa*(theta-r)/12 + sigma*Math.sqrt(1/12)*boxMuller();
      return {t:+(t*2/12).toFixed(2), r:+(r*100).toFixed(3)};
    });
  });
}
const PATH_COLORS = ["#2A8FD4","#1AADAD","#4A8EC0","#2A9070","#5090D0","#1A9898","#3A80B8","#2A8060"];

/* ─── GLOBAL CSS ──────────────────────────────────────────────────────────── */
const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=DM+Serif+Display:ital@0;1&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:${T.bg};color:${T.text};}
  ::-webkit-scrollbar{width:3px;background:transparent;}
  ::-webkit-scrollbar-thumb{background:${T.border2};border-radius:2px;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
  @keyframes spin{to{transform:rotate(360deg);}}
  .fade-1{animation:fadeUp 0.3s 0.00s both;}
  .fade-2{animation:fadeUp 0.3s 0.06s both;}
  .fade-3{animation:fadeUp 0.3s 0.12s both;}
  .tab-btn{transition:color 0.12s,border-color 0.12s;}
  .row-h{transition:background 0.08s;}
  .row-h:hover{background:rgba(42,143,212,0.05)!important;}
  .spinner{width:14px;height:14px;border:2px solid ${T.border2};border-top-color:${T.blue};border-radius:50%;animation:spin 0.7s linear infinite;display:inline-block;}
`;

/* ─── PRIMITIVES ──────────────────────────────────────────────────────────── */
function Label({children,color,size=9}){
  return <div style={{fontFamily:mono,fontSize:size,letterSpacing:"0.16em",textTransform:"uppercase",color:color||T.muted,marginBottom:5}}>{children}</div>;
}
function Divider({my=24}){return <div style={{height:1,background:T.border,margin:`${my}px 0`}}/>;}
function KpiBlock({label,value,sub}){
  return (
    <div style={{borderLeft:`1px solid ${T.border}`,paddingLeft:20,paddingRight:20}}>
      <Label>{label}</Label>
      <div style={{fontFamily:serif,fontSize:22,color:T.text,lineHeight:1,letterSpacing:"-0.01em"}}>{value}</div>
      {sub && <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:5}}>{sub}</div>}
    </div>
  );
}
function ChartTip({active,payload,label,suffix=""}){
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:T.surf,border:`1px solid ${T.border2}`,padding:"10px 14px",fontFamily:mono,fontSize:11}}>
      <div style={{color:T.blue,marginBottom:6}}>{label}{suffix}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color,marginBottom:2}}>
          <span style={{color:T.muted}}>{p.name}: </span>
          {typeof p.value==="number"?p.value.toFixed(3):p.value}
        </div>
      ))}
    </div>
  );
}

/* ─── BOOTSTRAP TAB ───────────────────────────────────────────────────────── */
function BootstrapTab({curveData,loading,error,date}){
  if(loading) return (
    <div className="fade-3" style={{padding:"48px 44px",display:"flex",alignItems:"center",gap:14}}>
      <div className="spinner"/>
      <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>fetching US Treasury yield curve...</span>
    </div>
  );

  const rows   = curveData;
  const spread = (rows.find(r=>r.tenor===10)?.spot??0)-(rows.find(r=>r.tenor===2)?.spot??0);
  const CustomDot = ({cx,cy}) => <circle cx={cx} cy={cy} r={3} fill={T.bg} stroke={T.blue} strokeWidth={1.5}/>;

  return (
    <div className="fade-3" style={{padding:"32px 44px",overflowY:"auto",height:"100%"}}>
      {error && (
        <div style={{padding:"10px 14px",background:T.amberLo,border:`1px solid ${T.amber}`,marginBottom:24,fontFamily:mono,fontSize:10,color:T.amber,lineHeight:1.8}}>
          ⚠ CORS blocked — showing fallback data. Run <span style={{color:T.blue}}>python data/fetch.py</span> + redeploy for live data.
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",marginBottom:32}}>
        <div>
          <Label color={T.blue}>2s10s spread</Label>
          <div style={{fontFamily:serif,fontSize:44,color:spread>=0?T.blue:T.red,lineHeight:1}}>
            {spread>=0?"+":""}{(spread*100).toFixed(0)} bps
          </div>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:6}}>
            {spread>=0?"normal · upward sloping":"inverted · recession signal"}
          </div>
        </div>
        <KpiBlock label="2Y spot"  value={`${rows.find(r=>r.tenor===2)?.spot.toFixed(3)??"—"}%`}/>
        <KpiBlock label="10Y spot" value={`${rows.find(r=>r.tenor===10)?.spot.toFixed(3)??"—"}%`}/>
        <KpiBlock label="30Y spot" value={`${rows.find(r=>r.tenor===30)?.spot.toFixed(3)??"—"}%`}/>
      </div>

      <Divider/>

      <div style={{display:"grid",gridTemplateColumns:"1.4fr 0.6fr",gap:48}}>
        <div>
          <Label>Par · spot · forward curves</Label>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,margin:"6px 0 18px"}}>
            <span style={{color:T.blue}}>——</span>&ensp;Spot&emsp;
            <span style={{color:T.cyan}}>——</span>&ensp;Par&emsp;
            <span style={{color:T.muted}}>– –</span>&ensp;Forward
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={rows} margin={{top:4,right:8,bottom:4,left:8}}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="tenor" type="number" domain={[0,31]} stroke={T.border}
                tick={{fill:T.muted,fontSize:9,fontFamily:mono}}
                tickFormatter={v=>`${v}Y`} tickLine={false} axisLine={{stroke:T.border}}/>
              <YAxis stroke={T.border} tick={{fill:T.muted,fontSize:9,fontFamily:mono}}
                tickLine={false} axisLine={false} width={44} tickFormatter={v=>`${v.toFixed(1)}%`}/>
              <Tooltip content={<ChartTip suffix="Y"/>} cursor={{stroke:T.border}}/>
              <Line type="monotone" dataKey="spot" stroke={T.blue}  strokeWidth={2}   dot={<CustomDot/>} name="Spot"/>
              <Line type="monotone" dataKey="par"  stroke={T.cyan}  strokeWidth={1.5} dot={false} name="Par"/>
              <Line type="monotone" dataKey="fwd"  stroke={T.muted} strokeWidth={1.5} dot={false} strokeDasharray="5 4" name="Forward"/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div>
          <Label>Bootstrapped spot rates</Label>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,margin:"6px 0 14px"}}>
            recursive extraction · semi-annual compounding
          </div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              {["Tenor","Par","Spot","Δ"].map((h,i)=>(
                <th key={h} style={{padding:"0 0 8px",textAlign:i===0?"left":"right",
                  fontFamily:mono,fontWeight:400,fontSize:9,letterSpacing:"0.12em",
                  textTransform:"uppercase",color:T.muted,borderBottom:`1px solid ${T.border}`}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map(s=>{
                const d = s.spot-s.par;
                return (
                  <tr key={s.tenor} className="row-h">
                    <td style={{padding:"7px 0",fontFamily:mono,fontSize:11,color:T.muted,borderBottom:`1px solid ${T.border}`}}>{s.tenor}Y</td>
                    <td style={{padding:"7px 0",fontFamily:mono,fontSize:11,textAlign:"right",color:T.text,borderBottom:`1px solid ${T.border}`}}>{s.par.toFixed(2)}%</td>
                    <td style={{padding:"7px 0",fontFamily:mono,fontSize:11,textAlign:"right",color:T.blue,borderBottom:`1px solid ${T.border}`}}>{s.spot.toFixed(3)}%</td>
                    <td style={{padding:"7px 0",fontFamily:mono,fontSize:11,textAlign:"right",
                      color:d>=0?T.green:T.red,borderBottom:`1px solid ${T.border}`}}>
                      {d>=0?"+":""}{(d*100).toFixed(1)}bp
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{marginTop:16,padding:"12px 14px",background:T.blueLo,border:`1px solid ${T.border2}`}}>
            <Label color={T.blue}>No-arbitrage condition</Label>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,lineHeight:1.8}}>
              (1+s₂)² = (1+s₁) × (1+f(1,2))<br/>
              f(T₁,T₂) = [(1+s₂)^T₂/(1+s₁)^T₁]^(1/(T₂−T₁)) − 1
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── NELSON-SIEGEL TAB ───────────────────────────────────────────────────── */
function NelsonSiegelTab({curveData, fetchDate}){
  const [params, setParams] = useState(null);
  const [manual, setManual] = useState(null);

  useEffect(()=>{
    if (!curveData.length) return;
    const tenors = curveData.map(r=>r.tenor);
    const yields = curveData.map(r=>r.spot);
    const fitted = fitNS(tenors, yields);
    setParams(fitted);
    setManual(fitted);
  }, [curveData]);

  if (!manual) return (
    <div className="fade-3" style={{padding:"48px 44px",fontFamily:mono,fontSize:11,color:T.muted}}>
      <div className="spinner"/> &ensp;Fitting Nelson-Siegel…
    </div>
  );

  const {b0,b1,b2,lam} = manual;
  const tenors = curveData.map(r=>r.tenor);
  const yields = curveData.map(r=>r.spot);
  const fittedCurve = Array.from({length:120},(_,i)=>{
    const tau = (i+1)*0.25;
    return {tenor:+tau.toFixed(2), fitted:+nsYield(tau,b0,b1,b2,lam).toFixed(4)};
  });
  const observed = curveData.map(r=>({tenor:r.tenor,observed:r.spot}));
  const rmse = Math.sqrt(tenors.reduce((s,t,i)=>s+(yields[i]-nsYield(t,b0,b1,b2,lam))**2,0)/tenors.length)*100;

  return (
    <div className="fade-3" style={{padding:"32px 44px",overflowY:"auto",height:"100%"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",marginBottom:32}}>
        <div>
          <Label color={T.blue}>β₀ — level</Label>
          <div style={{fontFamily:serif,fontSize:44,color:T.blue,lineHeight:1}}>{b0.toFixed(2)}%</div>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:6}}>long-run yield as τ→∞</div>
        </div>
        <KpiBlock label="β₁ — slope"     value={`${b1.toFixed(2)}%`} sub={`β₀+β₁ = ${(b0+b1).toFixed(2)}% (short rate)`}/>
        <KpiBlock label="β₂ — curvature" value={`${b2.toFixed(2)}%`} sub="medium-term hump / belly"/>
        <KpiBlock label="λ — decay"       value={lam.toFixed(2)}      sub={`RMSE = ${rmse.toFixed(2)}bp`}/>
      </div>

      <Divider/>

      <div style={{display:"grid",gridTemplateColumns:"1.4fr 0.6fr",gap:48}}>
        <div>
          <Label>Nelson-Siegel fitted curve</Label>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,margin:"6px 0 18px"}}>
            <span style={{color:T.blue}}>——</span>&ensp;NS fitted&emsp;
            <span style={{color:T.cyan}}>◆</span>&ensp;Observed spot rates&emsp;
            {fetchDate && fetchDate !== "—" && <span>· as of {fetchDate}</span>}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart margin={{top:4,right:8,bottom:4,left:8}}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="tenor" type="number" domain={[0,31]} stroke={T.border}
                tick={{fill:T.muted,fontSize:9,fontFamily:mono}}
                tickFormatter={v=>`${v}Y`} tickLine={false} axisLine={{stroke:T.border}}/>
              <YAxis stroke={T.border} tick={{fill:T.muted,fontSize:9,fontFamily:mono}}
                tickLine={false} axisLine={false} width={44} tickFormatter={v=>`${v.toFixed(1)}%`}/>
              <Tooltip content={<ChartTip suffix="Y"/>} cursor={{stroke:T.border}}/>
              <Line data={fittedCurve} type="monotone" dataKey="fitted"
                stroke={T.blue} strokeWidth={2} dot={false} name="NS fitted"/>
              <Line data={observed} type="monotone" dataKey="observed"
                stroke={T.cyan} strokeWidth={0} dot={{fill:T.cyan,r:4,strokeWidth:0}} name="Observed"/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div>
          <Label>Adjust parameters</Label>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,margin:"6px 0 18px"}}>
            drag to explore · OLS auto-fits on load
          </div>
          {[
            {key:"b0", label:"β₀ — level",     min:1,   max:10,  step:0.05},
            {key:"b1", label:"β₁ — slope",     min:-5,  max:5,   step:0.05},
            {key:"b2", label:"β₂ — curvature", min:-5,  max:5,   step:0.05},
            {key:"lam",label:"λ — decay",       min:0.3, max:10,  step:0.1 },
          ].map(({key,label,min,max,step})=>(
            <div key={key} style={{marginBottom:20}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <Label>{label}</Label>
                <span style={{fontFamily:mono,fontSize:11,color:T.blue}}>
                  {manual[key].toFixed(2)}{key==="lam"?"Y":"%"}
                </span>
              </div>
              <input type="range" min={min} max={max} step={step} value={manual[key]}
                onChange={e=>setManual(p=>({...p,[key]:parseFloat(e.target.value)}))}
                style={{width:"100%",accentColor:T.blue,cursor:"pointer"}}/>
            </div>
          ))}
          <button onClick={()=>setManual(params)}
            style={{width:"100%",padding:"8px 0",background:T.blueLo,border:`1px solid ${T.border2}`,
              color:T.blue,fontFamily:mono,fontSize:9,letterSpacing:"0.14em",
              textTransform:"uppercase",cursor:"pointer",marginBottom:16}}>
            reset to fitted
          </button>
          <div style={{padding:"12px 14px",background:T.blueLo,border:`1px solid ${T.border2}`}}>
            <Label color={T.blue}>NS formula</Label>
            <div style={{fontFamily:mono,fontSize:9,color:T.muted,lineHeight:2.0}}>
              y(τ) = β₀<br/>
              &emsp;+ β₁·(1−e^(−τ/λ))/(τ/λ)<br/>
              &emsp;+ β₂·[(1−e^(−τ/λ))/(τ/λ) − e^(−τ/λ)]
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── PCA TAB ─────────────────────────────────────────────────────────────── */
function PCATab(){
  const [activePC, setActivePC] = useState(0);
  const [pca,      setPca]      = useState(null);
  const [error,    setError]    = useState(null);

  useEffect(()=>{
    fetch(PCA_URL)
      .then(r=>{ if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setPca)
      .catch(e=>setError(e.message));
  },[]);

  if (error) return (
    <div className="fade-3" style={{padding:"48px 44px",fontFamily:mono,fontSize:11,color:T.amber}}>
      ⚠ PCA data unavailable ({error}). Run <span style={{color:T.blue}}>python data/build_dashboard_data.py</span> and redeploy.
    </div>
  );
  if (!pca) return (
    <div className="fade-3" style={{padding:"48px 44px",fontFamily:mono,fontSize:11,color:T.muted}}>
      <div className="spinner"/> &ensp;Loading PCA…
    </div>
  );

  const pcs = pca.loadings.map((loading,k)=>({loading, variancePct:pca.variance_pct[k]}));

  const PC_META = [
    {label:"PC1 — Level",     color:T.blue,  desc:"All maturities shift together. Parallel shift. Fed hike/cut cycles."},
    {label:"PC2 — Slope",     color:T.cyan,  desc:"Short and long ends diverge. Steepener/flattener. 2s10s spread trade."},
    {label:"PC3 — Curvature", color:T.amber, desc:"Belly vs wings. Butterfly: long 5Y, short 2Y and 10Y."},
  ];

  const pc       = pcs[activePC];
  const pcMeta   = PC_META[activePC];
  const totalVar = pcs.reduce((s,p)=>s+p.variancePct,0);
  const loadingData = pca.tenors.map((t,i)=>({tenor:tenorLabel(t), loading:pc.loading[i]}));

  return (
    <div className="fade-3" style={{padding:"32px 44px",overflowY:"auto",height:"100%"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",marginBottom:32}}>
        <div>
          <Label color={T.blue}>Variance explained</Label>
          <div style={{fontFamily:serif,fontSize:44,color:T.blue,lineHeight:1}}>{totalVar.toFixed(1)}%</div>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:6}}>first 3 components</div>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:4}}>
            daily Δ par yields · {pca.start} → {pca.end} · {pca.n_obs} days
          </div>
        </div>
        {pcs.map((p,k)=>(
          <KpiBlock key={k} label={PC_META[k].label} value={`${p.variancePct.toFixed(1)}%`}/>
        ))}
      </div>

      <Divider/>

      <div style={{display:"grid",gridTemplateColumns:"1.4fr 0.6fr",gap:48}}>
        <div>
          <Label>Principal component loadings</Label>
          <div style={{display:"flex",gap:8,margin:"12px 0 18px"}}>
            {PC_META.map((m,k)=>(
              <button key={k} className="tab-btn" onClick={()=>setActivePC(k)}
                style={{padding:"6px 14px",background:activePC===k?m.color+"22":"transparent",
                  border:`1px solid ${activePC===k?m.color:T.border}`,
                  color:activePC===k?m.color:T.muted,
                  fontFamily:mono,fontSize:9,letterSpacing:"0.12em",
                  textTransform:"uppercase",cursor:"pointer",transition:"all 0.12s"}}>
                {m.label}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={loadingData} margin={{top:4,right:4,bottom:4,left:0}} barSize={22}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="tenor" stroke={T.border}
                tick={{fill:T.muted,fontSize:9,fontFamily:mono}}
                tickLine={false} axisLine={{stroke:T.border}}/>
              <YAxis stroke={T.border} tick={{fill:T.muted,fontSize:9,fontFamily:mono}}
                tickLine={false} axisLine={false} width={48} tickFormatter={v=>v.toFixed(2)}/>
              <Tooltip content={({active,payload,label})=>active&&payload?.length?(
                <div style={{background:T.surf,border:`1px solid ${T.border2}`,padding:"8px 12px",fontFamily:mono,fontSize:11}}>
                  <div style={{color:pcMeta.color,marginBottom:4}}>{label}</div>
                  <div style={{color:T.text}}>Loading: {payload[0]?.value?.toFixed(4)}</div>
                </div>
              ):null} cursor={{fill:"rgba(42,143,212,0.04)"}}/>
              <ReferenceLine y={0} stroke={T.border2}/>
              <Bar dataKey="loading" radius={[2,2,0,0]}>
                {loadingData.map((d,i)=>(
                  <Cell key={i} fill={d.loading>=0?pcMeta.color:pcMeta.color+"55"}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div>
          <Label>Factor interpretation</Label>
          <div style={{marginTop:14}}>
            {PC_META.map((m,k)=>(
              <div key={k} onClick={()=>setActivePC(k)}
                style={{padding:"14px",marginBottom:10,
                  border:`1px solid ${activePC===k?m.color:T.border}`,
                  background:activePC===k?m.color+"0A":"transparent",
                  cursor:"pointer",transition:"all 0.12s"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontFamily:mono,fontSize:10,
                    color:activePC===k?m.color:T.muted,
                    letterSpacing:"0.1em",textTransform:"uppercase"}}>{m.label}</span>
                  <span style={{fontFamily:mono,fontSize:10,color:m.color}}>
                    {pcs[k].variancePct.toFixed(1)}%
                  </span>
                </div>
                <div style={{fontFamily:mono,fontSize:10,color:T.muted,lineHeight:1.7}}>{m.desc}</div>
              </div>
            ))}
            <div style={{padding:"12px 14px",background:T.blueLo,border:`1px solid ${T.border2}`}}>
              <Label color={T.blue}>Eigendecomposition</Label>
              <div style={{fontFamily:mono,fontSize:9,color:T.muted,lineHeight:2.0}}>
                Σ = V · Λ · Vᵀ<br/>
                Σ = cov(Δyields) across maturities<br/>
                Columns of V = loading vectors<br/>
                Λ = diag(eigenvalues) = variance
              </div>
            </div>
          </div>
        </div>
      </div>

      {pca.trades?.length > 0 && (<>
        <Divider/>
        <Label>PCA-neutral curve trades</Label>
        <div style={{fontFamily:mono,fontSize:10,color:T.muted,margin:"6px 0 14px"}}>
          DV01 hedge ratios from the loadings above · P&L in $ for a +1bp move in each factor
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
          {pca.trades.map(t=>(
            <div key={t.name} style={{border:`1px solid ${T.border}`,padding:"14px 16px"}}>
              <div style={{fontFamily:mono,fontSize:11,color:T.text,marginBottom:4}}>
                {t.name} <span style={{color:T.muted}}>· {t.neutral_to.join("/")}-neutral</span>
              </div>
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginBottom:10}}>{t.note}</div>
              <table style={{width:"100%",fontFamily:mono,fontSize:10,borderCollapse:"collapse"}}>
                <tbody>
                  {t.legs.map(l=>(
                    <tr key={l.tenor}>
                      <td style={{color:T.muted,padding:"3px 0"}}>{tenorLabel(l.tenor)} DV01</td>
                      <td style={{textAlign:"right",color:l.dv01>=0?T.blue:T.amber}}>{fmtUsd(l.dv01)}/bp</td>
                    </tr>
                  ))}
                  {t.exposures.map((e,k)=>(
                    <tr key={k}>
                      <td style={{color:T.muted,padding:"3px 0"}}>P&L if PC{k+1} +1bp</td>
                      <td style={{textAlign:"right",color:Math.abs(e)<0.5?T.muted:T.text}}>
                        {Math.abs(e)<0.5?"0 (neutral)":fmtUsd(e)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}

/* ─── VASICEK TAB ─────────────────────────────────────────────────────────── */
function VasicekTab({curveData}){
  // Fallback r₀: today's 1Y spot rate if live data is available
  const liveR0 = curveData.find(r=>r.tenor===1)?.spot
               ?? curveData.find(r=>r.tenor===0.5)?.spot
               ?? 3.00;

  const [kappa,setKappa]=useState(0.30);
  const [theta,setTheta]=useState(5.00);
  const [sigma,setSigma]=useState(1.80);
  const [r0,setR0]=useState(null); // null = use the default below
  const [cal,setCal]=useState(null);
  const [calErr,setCalErr]=useState(null);

  // Start the sliders at the market calibration when it is usable
  useEffect(()=>{
    fetch(VASICEK_URL)
      .then(r=>{ if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(c=>{
        setCal(c);
        if (usableCalibration(c)) {
          setKappa(+c.kappa.toFixed(2));
          setTheta(+(c.theta*100).toFixed(2));
          setSigma(+(c.sigma*100).toFixed(2));
        }
      })
      .catch(e=>setCalErr(e.message));
  },[]);

  // The model is calibrated to the 3M bill, so r₀ defaults to its last close
  const defaultR0   = cal ? cal.r_last*100 : liveR0;
  const effectiveR0 = r0 ?? defaultR0;
  const paths  = genPaths(8,kappa,theta/100,sigma/100,effectiveR0/100);
  const feller = 2*kappa*(theta/100)>Math.pow(sigma/100,2);
  const ert    = theta+(effectiveR0-theta)*Math.exp(-kappa);

  return (
    <div className="fade-3" style={{padding:"32px 44px",overflowY:"auto",height:"100%"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",marginBottom:32}}>
        <div>
          <Label color={T.blue}>Long-run mean θ</Label>
          <div style={{fontFamily:serif,fontSize:44,color:T.blue,lineHeight:1}}>{theta.toFixed(2)}%</div>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:6}}>E[r<sub>∞</sub>] = θ · rates revert here</div>
        </div>
        <KpiBlock label="r₀ — today"      value={`${effectiveR0.toFixed(2)}%`}  sub={cal?"3M T-bill, last close":"1Y Treasury spot rate"}/>
        <KpiBlock label="E[r] at 1Y"      value={`${ert.toFixed(3)}%`} sub="θ + (r₀−θ)·e^(−κ)"/>
        <KpiBlock label="Feller condition" value={feller?"✓ holds":"✗ fails"}
          sub={feller?"positive rates guaranteed (CIR)":"negative rates possible"}/>
      </div>
      <Divider/>
      <div style={{display:"grid",gridTemplateColumns:"1.4fr 0.6fr",gap:48}}>
        <div>
          <Label>Monte Carlo short rate paths</Label>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,margin:"6px 0 18px"}}>
            dr = κ(θ−r)dt + σdW · 8 sample paths · mean reversion to&ensp;
            <span style={{color:T.blue}}>θ = {theta.toFixed(2)}%</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart margin={{top:4,right:8,bottom:4,left:8}}>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false}/>
              <XAxis dataKey="t" type="number" domain={[0,5]} stroke={T.border}
                tick={{fill:T.muted,fontSize:9,fontFamily:mono}}
                tickFormatter={v=>`${v}Y`} tickLine={false} axisLine={{stroke:T.border}}/>
              <YAxis stroke={T.border} tick={{fill:T.muted,fontSize:9,fontFamily:mono}}
                tickLine={false} axisLine={false} width={44} tickFormatter={v=>`${v.toFixed(1)}%`}/>
              <ReferenceLine y={theta} stroke={T.blue} strokeDasharray="4 3" strokeOpacity={0.5}/>
              <Tooltip content={({active,payload,label})=>active&&payload?.length?(
                <div style={{background:T.surf,border:`1px solid ${T.border2}`,padding:"8px 12px",fontFamily:mono,fontSize:11}}>
                  <div style={{color:T.blue,marginBottom:4}}>t = {parseFloat(label).toFixed(2)}Y</div>
                  {payload.slice(0,4).map((p,i)=><div key={i} style={{color:p.color}}>{p.value?.toFixed(3)}%</div>)}
                </div>
              ):null} cursor={{stroke:T.border}}/>
              {paths.map((path,i)=>(
                <Line key={i} data={path} dataKey="r" type="monotone"
                  stroke={PATH_COLORS[i]} strokeWidth={1} dot={false} strokeOpacity={0.65} name={`Path ${i+1}`}/>
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <Label>Model parameters</Label>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,margin:"6px 0 18px"}}>start at the market calibration · adjust to explore</div>
          {[
            {label:"κ — mean reversion speed",value:kappa,set:setKappa,min:0.01,max:5.0, step:0.01,fmt:v=>v.toFixed(2)},
            {label:"θ — long-run mean (%)",   value:theta,set:setTheta,min:0.5, max:10.0,step:0.1, fmt:v=>v.toFixed(2)+"%"},
            {label:"σ — volatility (%)",      value:sigma,set:setSigma,min:0.1, max:5.0, step:0.05,fmt:v=>v.toFixed(2)+"%"},
            {label:"r₀ — initial rate (%)",   value:effectiveR0,set:setR0,   min:0.1, max:10.0,step:0.1, fmt:v=>v.toFixed(2)+"%"},
          ].map(({label,value,set,min,max,step,fmt})=>(
            <div key={label} style={{marginBottom:20}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <Label>{label}</Label>
                <span style={{fontFamily:mono,fontSize:11,color:T.blue}}>{fmt(value)}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={value}
                onChange={e=>set(parseFloat(e.target.value))}
                style={{width:"100%",accentColor:T.blue,cursor:"pointer"}}/>
            </div>
          ))}
          <div style={{padding:"12px 14px",background:feller?T.blueLo:T.amberLo,
            border:`1px solid ${feller?T.border2:T.amber}`,marginTop:4,transition:"all 0.2s"}}>
            <Label color={feller?T.blue:T.amber}>
              {feller?"Feller condition satisfied":"Feller condition violated"}
            </Label>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,lineHeight:1.8}}>
              2κθ = {(2*kappa*theta/100).toFixed(4)}<br/>
              σ² = {Math.pow(sigma/100,2).toFixed(6)}<br/>
              {feller?"CIR: positive rates guaranteed":"Vasicek: negative rates possible"}
            </div>
          </div>
          <div style={{padding:"12px 14px",border:`1px solid ${T.border2}`,marginTop:12}}>
            <Label color={T.cyan}>Calibrated to market</Label>
            {cal ? (
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,lineHeight:1.8}}>
                3M T-bill · {cal.start} → {cal.end} · {cal.n_obs} days<br/>
                κ = {cal.kappa.toFixed(2)} (s.e. {cal.kappa_se.toFixed(2)}) · half-life {cal.half_life_years ? `${cal.half_life_years.toFixed(1)}y` : "n/a"}<br/>
                θ = {(cal.theta*100).toFixed(2)}% · σ = {(cal.sigma*100).toFixed(2)}%<br/>
                {usableCalibration(cal)
                  ? "OLS on the discretised SDE; sliders start here."
                  : "Mean reversion is not identified in this sample; sliders show illustrative defaults."}
              </div>
            ) : (
              <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{calErr ? `unavailable (${calErr})` : "loading…"}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN ────────────────────────────────────────────────────────────────── */
export default function App(){
  const [tab,       setTab]       = useState("bootstrap");
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [curveData, setCurveData] = useState([]);
  const [fetchDate, setFetchDate] = useState("—");

  const FALLBACK = [
    {tenor:0.5,par:5.30,spot:5.32,fwd:5.32},{tenor:1,par:5.10,spot:5.14,fwd:4.96},
    {tenor:2,par:4.80,spot:4.86,fwd:4.58},{tenor:3,par:4.65,spot:4.72,fwd:4.46},
    {tenor:5,par:4.50,spot:4.59,fwd:4.47},{tenor:7,par:4.55,spot:4.65,fwd:4.86},
    {tenor:10,par:4.60,spot:4.72,fwd:4.98},{tenor:20,par:4.80,spot:4.96,fwd:5.42},
    {tenor:30,par:4.90,spot:5.08,fwd:5.64},
  ];

  useEffect(()=>{
    fetchTreasuryYields()
      .then(({date,yields})=>{
        const parYields = Object.entries(yields)
          .map(([t,y])=>[parseFloat(t),y])
          .filter(([t])=>t>=0.5)
          .sort((a,b)=>a[0]-b[0]);
        const spots = bootstrapSpots(parYields);
        const fwds  = spotsToForwards(spots);
        setCurveData(parYields.map(([tenor,par])=>({
          tenor, par, spot:spots[tenor]??par, fwd:fwds[tenor]??par,
        })));
        setFetchDate(date);
        setLoading(false);
      })
      .catch(err=>{
        setError(err.message);
        setCurveData(FALLBACK);
        setFetchDate("fallback");
        setLoading(false);
      });
  },[]);

  const TABS = [
    {id:"bootstrap",l:"Bootstrapper"},
    {id:"ns",       l:"Nelson-Siegel"},
    {id:"pca",      l:"PCA"},
    {id:"vasicek",  l:"Vasicek / CIR"},
  ];

  const r2  = curveData.find(r=>r.tenor===2)?.spot  ?? 0;
  const r10 = curveData.find(r=>r.tenor===10)?.spot ?? 0;
  const r30 = curveData.find(r=>r.tenor===30)?.spot ?? 0;
  const r5  = curveData.find(r=>r.tenor===5)?.spot  ?? 0;
  const spread = r10-r2;
  const isLive = !error && !loading;

  return (
    <div style={{background:T.bg,minHeight:"100vh",display:"flex",flexDirection:"column"}}>
      <style>{css}</style>

      {/* ── HEADER ── */}
      <div className="fade-1" style={{borderBottom:`1px solid ${T.border}`,padding:"0 40px",
        height:48,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{width:2,height:18,background:T.blue}}/>
          <span style={{fontFamily:serif,fontSize:15,color:T.text}}>Yield Curve Suite</span>
          <div style={{width:1,height:14,background:T.border}}/>
          <span style={{fontFamily:mono,fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase",color:T.muted}}>
            Bootstrap · Nelson-Siegel · PCA · Vasicek
          </span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:20}}>
          <span style={{fontFamily:mono,fontSize:9,color:isLive?T.green:error?T.amber:T.muted}}>
            {loading?"fetching...":isLive?`● live · ${fetchDate}`:`⚠ fallback · ${fetchDate}`}
          </span>
          <div style={{width:1,height:12,background:T.border}}/>
          <span style={{fontFamily:mono,fontSize:9,color:T.muted}}>
            {new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"2-digit",year:"numeric"}).toUpperCase()}
          </span>
        </div>
      </div>

      {/* ── STATUS BAR ── */}
      <div className="fade-2" style={{borderBottom:`1px solid ${T.border}`,padding:"0 40px",
        height:30,display:"flex",alignItems:"center",background:T.surf,flexShrink:0}}>
        {[
          ["2Y",    r2  ?`${r2.toFixed(2)}%`:"—"],
          ["5Y",    r5  ?`${r5.toFixed(2)}%`:"—"],
          ["10Y",   r10 ?`${r10.toFixed(2)}%`:"—"],
          ["30Y",   r30 ?`${r30.toFixed(2)}%`:"—"],
          ["2s10s", r10 ?`${spread>=0?"+":""}${(spread*100).toFixed(0)}bp`:"—"],
          ["As of", isLive ? fetchDate : "stub data"],
          ["Source","US Treasury · bootstrapped"],
        ].map(([k,v],i)=>(
          <div key={k} style={{display:"flex",alignItems:"center"}}>
            {i>0&&<div style={{width:1,height:12,background:T.border,margin:"0 14px"}}/>}
            <span style={{fontFamily:mono,fontSize:9,color:T.muted,marginRight:6,letterSpacing:"0.1em",textTransform:"uppercase"}}>{k}</span>
            <span style={{fontFamily:mono,fontSize:10,
              color:k==="Source"&&isLive?T.green:k==="As of"&&isLive?T.green:T.blue,
              fontWeight:500}}>{v}</span>
          </div>
        ))}
      </div>

      {/* ── TAB BAR ── */}
      <div className="fade-2" style={{borderBottom:`1px solid ${T.border}`,display:"flex",paddingLeft:40,flexShrink:0}}>
        {TABS.map(({id,l})=>(
          <button key={id} className="tab-btn" onClick={()=>setTab(id)} style={{
            padding:"13px 0",marginRight:28,marginBottom:-1,
            background:"transparent",border:"none",
            borderBottom:`1px solid ${tab===id?T.blue:"transparent"}`,
            color:tab===id?T.blue:T.muted,
            fontFamily:mono,fontSize:9,letterSpacing:"0.16em",
            textTransform:"uppercase",cursor:"pointer",
          }}>{l}</button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {tab==="bootstrap"&&<BootstrapTab curveData={curveData} loading={loading} error={error} date={fetchDate}/>}
        {tab==="ns"       &&<NelsonSiegelTab curveData={curveData} fetchDate={fetchDate}/>}
        {tab==="pca"      &&<PCATab/>}
        {tab==="vasicek"  &&<VasicekTab curveData={curveData}/>}
      </div>
    </div>
  );
}
