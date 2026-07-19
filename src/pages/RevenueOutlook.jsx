/* ============================================================================
   RevenueOutlook.jsx
   ----------------------------------------------------------------------------
   Dependencies: react, recharts, @apollo/client (all in package.json).
   Styling is inline + one scoped <style> (no Tailwind).
   Font: Inter (falls back to system SF Pro / Segoe UI). For best results add
   to index.html:
     <link rel="preconnect" href="https://rsms.me/">
     <link rel="stylesheet" href="https://rsms.me/inter/inter.css">

   LIVE DATA: reads from Fabric GraphQL via useQuery.
   - Queries live in src/graphql/queries.js (GET_REVENUE_DATA, GET_ISSUANCE_DATA)
   - normalizeRows() tolerates the different shapes Fabric may return
   - mapRevenueRow() / mapIssuanceRow() convert lakehouse column names
     to the internal row shape

   2026 FORECAST RULE (applies everywhere "Fcst" is shown for the current
   year): actuals for every month that has actuals loaded, plus the Q2
   Forecast for the remaining months. The cutoff month is detected from the
   data itself (last month of CURRENT_YEAR with a non-zero actual).

   SFG RULE: the Pricing construct / Product type filters never exclude SFG
   rows (SFG carries placeholder values in those columns), and "SFG" is
   hidden as a member of those dropdowns.

   Tabs: LOB Summary · Revenue Phasing · Issuance Phasing · Performance · Outlook Table
============================================================================ */

import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  ReferenceLine, Cell,
} from "recharts";
import { useQuery } from "@apollo/client";
import { GET_REVENUE_DATA, GET_ISSUANCE_DATA } from "../graphql/queries.js";

/* ============================================================================
   BRAND + UI TOKENS — Moody's palette, Apple-grade chrome
============================================================================ */
const BRAND = {
  blue10: "#0A1264",
  brightBlue: "#005EFF",
  white: "#FFFFFF",
  darkGray: "#4F5153",
  mediumGray: "#75787B",
  lightGray: "#F0F0F1",
  borderGray: "#D7D8D7",
  black: "#1D1D1F",
  low: "#00B050",
  critical: "#E5484D",
  teal: "#5BC2C9",
  gold: "#C9A227",
};

const UI = {
  bg: "#F5F5F7",
  line: "#E4E6EB",
  lineSoft: "#F0F1F4",
  radius: 12,
  shadow: "0 1px 2px rgba(10, 18, 100, 0.05)",
};

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const LOB_COLORS = {
  CFG: "#0A1264",
  FIG: "#005EFF",
  PPIF: "#4A9EA8",
  SFG: "#8FBC5A",
  "Other MR": "#75787B",
};

/* ============================================================================
   CANONICAL ORDERING — source of truth; never sort alphabetically
============================================================================ */
const LOB_ORDER = ["CFG", "FIG", "PPIF", "SFG", "Other MR"];
const REGION_ORDER = ["US", "EMEA", "APAC", "Canada Region", "Latin America", "Other"];
const YEARS = [2023, 2024, 2025, 2026];
const CURRENT_YEAR = 2026;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const IS_JV = ["N", "Y"];
const BILL_TYPES = ["Transactional", "Recurring"];

const SUB_LOB_BY_LOB = {
  CFG: ["CFG Bonds IG", "CFG Bonds SG", "CFG Bank Loans", "CFG Other Trans", "CFG Recurring"],
  FIG: ["Banking", "Insurance", "FAM", "Other FIG"],
  PPIF: ["U.S. PFG", "Infrastructure Finance", "Project Finance", "Sovereign", "Sub-Sovereign", "Other PPIF"],
  SFG: ["ABCP", "ABS", "RMBS", "Covered Bonds", "CMBS", "Structured Credit", "Other SFG"],
  "Other MR": ["Other MR"],
};

/* Order a LOB's Sub-LOBs to match the canonical SUB_LOB_BY_LOB order — the same
   order Revenue uses — so Issuance lines up with Revenue instead of sorting by
   volume. Members not in the canonical list (Issuance-only Sub-LOBs) are
   appended alphabetically so they keep a stable, predictable position. */
function canonicalSubs(lob, present) {
  const canon = SUB_LOB_BY_LOB[lob] ?? [];
  const inCanon = canon.filter((s) => present.includes(s));
  const extras = present.filter((s) => !canon.includes(s)).sort();
  return [...inCanon, ...extras];
}

/* ============================================================================
   DATA WIRING
============================================================================ */

function mapRevenueRow(r) {
  const monthNo = Number(r.MonthNo);
  return {
    year: Number(r.Year),
    month: r.Month,
    monthNo,
    quarter: `Q${Math.floor((monthNo - 1) / 3) + 1}`,
    lob: r.LOB,
    subLob: r.Sub_LOB,
    transRecurring: r.Trans_Recurring,
    region: r.Region,
    isJV: r.Is_JV,
    usdAmount: Number(r.USD_Amount) || 0,
    usdBudgetBR: Number(r.USD_Budget_BR) || 0,
    usdQ2ForecastFR: r.USD_Q2_Forecast_FR == null ? null : Number(r.USD_Q2_Forecast_FR),
  };
}

function mapIssuanceRow(r) {
  const monthNo = Number(r.MonthNo);
  return {
    year: Number(r.Year),
    month: r.Month,
    monthNo,
    quarter: `Q${Math.floor((monthNo - 1) / 3) + 1}`,
    lob: r.LOB,
    subLob: r.Sub_LOB,
    product: r.High_Level_Product,
    pricing: r.Pricing_Construct,
    newExisting: r.New_Existing,
    extReporting: r.External_Reporting_Ind,
    region: r.Region,
    volM: Number(r.Volumes__M) || 0,
    deals: Number(r.Deals) || 0,
    budVolM: Number(r.Budget_Volumes__M) || 0,
    budDeals: Number(r.Budget_Deals) || 0,
    fcstVolM: r.Q2_Forecast_Volumes__M == null ? null : Number(r.Q2_Forecast_Volumes__M),
    fcstDeals: r.Q2_Forecast_Deals == null ? null : Number(r.Q2_Forecast_Deals),
  };
}

function normalizeRows(payload, rootKeys) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  for (const key of rootKeys) {
    const candidate = payload[key];
    if (!candidate) continue;
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate.items)) return candidate.items;
  }
  return [];
}

const REVENUE_ROOTS = ["revenue_datas", "revenueDatas", "revenue_data", "revenueData", "data"];
const ISSUANCE_ROOTS = ["issuance_datas", "issuanceDatas", "issuance_data", "issuanceData", "data"];

function useFabricRows(query, rootKeys, mapRow) {
  const { data, loading, error } = useQuery(query, {
    fetchPolicy: "network-only",
    errorPolicy: "all",
  });
  const rows = useMemo(
    () => normalizeRows(data, rootKeys).map(mapRow).filter((r) => r.year && r.month),
    [data, rootKeys, mapRow]
  );
  return { rows, loading, error };
}

/* Last month of CURRENT_YEAR with actuals loaded — drives the blended Fcst. */
function lastActualMonth(rows, getActual) {
  let last = 0;
  for (const r of rows) {
    if (r.year === CURRENT_YEAR && r.monthNo > last && getActual(r)) last = r.monthNo;
  }
  return last;
}

/* ============================================================================
   MEASURES — accessors + display transforms per dataset
============================================================================ */

const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
const fmtPct = (n) => `${n.toFixed(0)}%`;
const fmtSigned = (n) => `${n > 0 ? "+" : ""}${fmtInt(n)}`;
const pctChange = (a, b) => (b ? ((a - b) / b) * 100 : 0);
const sumBy = (arr, f) => arr.reduce((s, r) => s + (f(r) || 0), 0);

const REV_MEASURE = {
  name: "Revenue ($M)",
  unit: "$M",
  act: (r) => r.usdAmount,
  bud: (r) => r.usdBudgetBR,
  fcst: (r) => r.usdQ2ForecastFR,
  toDisplay: (v) => v / 1e6,
  fmt: (v) => (v == null ? "—" : fmtInt(v / 1e6)),
};

const ISS_MEASURES = [
  {
    name: "Volumes ($B)",
    unit: "$B",
    act: (r) => r.volM,
    bud: (r) => r.budVolM,
    fcst: (r) => r.fcstVolM,
    toDisplay: (v) => v / 1000,
    fmt: (v) => (v == null ? "—" : fmtInt(v / 1000)),
  },
  {
    name: "Deals",
    unit: "deals",
    act: (r) => r.deals,
    bud: (r) => r.budDeals,
    fcst: (r) => r.fcstDeals,
    toDisplay: (v) => v,
    fmt: (v) => (v == null ? "—" : fmtInt(v)),
  },
];

/* Blended value for a row in a given display year:
   past years → actuals; CURRENT_YEAR → actuals up to cutoff, then forecast. */
function blendedValue(r, yearNum, measure, cutoffMonth) {
  if (r.year !== yearNum) return 0;
  if (yearNum === CURRENT_YEAR) {
    return r.monthNo <= cutoffMonth ? measure.act(r) : (measure.fcst(r) ?? 0);
  }
  return measure.act(r);
}

function varColor(v) {
  if (v > 0) return BRAND.low;
  if (v < 0) return BRAND.critical;
  return BRAND.darkGray;
}
function varBg(v) {
  if (v > 0) return "rgba(0, 176, 80, 0.08)";
  if (v < 0) return "rgba(229, 72, 77, 0.08)";
  return "transparent";
}
const varArrow = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "");

const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();

/* ============================================================================
   SCOPED CSS — injected once
============================================================================ */
const SCOPED_CSS = `
html, body { margin: 0; padding: 0; width: 100%; display: block; }
#root { width: 100%; max-width: none; margin: 0; padding: 0; text-align: initial; display: block; }
.ro-root, .ro-root * { box-sizing: border-box; }
.ro-root { min-height: 100vh; width: 100%; overflow-x: clip; background: ${UI.bg}; font-family: ${FONT}; color: ${BRAND.black}; -webkit-font-smoothing: antialiased; }
.ro-container { width: 100%; margin: 0 auto; padding: 0 clamp(16px, 2vw, 40px); }
.ro-filters { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end; }
.ro-grid-2 { display: grid; grid-template-columns: 1fr; gap: 24px; }
@media (min-width: 1280px) { .ro-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ro-summary-layout { display: grid; grid-template-columns: 1fr; gap: 24px; align-items: start; }
@media (min-width: 1180px) { .ro-summary-layout { grid-template-columns: 280px minmax(0, 1fr); } }
.ro-summary-main { display: grid; grid-template-columns: 1fr; gap: 24px; }
@media (min-width: 1500px) { .ro-summary-main { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ro-side { display: flex; flex-direction: column; gap: 24px; }
.ro-model-grid { display: grid; grid-template-columns: 1fr; gap: 24px; align-items: start; }
@media (min-width: 1500px) { .ro-model-grid { grid-template-columns: minmax(0, 1fr) 360px; } }
.ro-scroll-x { overflow-x: auto; }
.ro-card { background: ${BRAND.white}; border: 1px solid ${UI.line}; border-radius: ${UI.radius}px; box-shadow: ${UI.shadow}; }
.ro-table { width: 100%; border-collapse: collapse; }
.ro-table td, .ro-table th { font-variant-numeric: tabular-nums; }
.ro-table tbody tr.ro-hover:hover { background: #FAFBFC; }
.ro-expand { cursor: pointer; user-select: none; }
.ro-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${BRAND.mediumGray}; }
.ro-select { background: ${BRAND.white}; border: 1px solid ${UI.line}; border-radius: 8px; padding: 8px 12px; font-size: 13px; min-width: 130px; color: ${BRAND.black}; font-family: ${FONT}; appearance: auto; }
.ro-select:focus { outline: none; border-color: ${BRAND.brightBlue}; box-shadow: 0 0 0 3px rgba(0, 94, 255, 0.12); }
.ro-tab-btn { background: none; border: none; cursor: pointer; font-family: ${FONT}; font-size: 13px; font-weight: 600; padding: 14px 4px 12px; margin-right: 24px; color: ${BRAND.mediumGray}; border-bottom: 2px solid transparent; white-space: nowrap; transition: color 0.15s ease; }
.ro-tab-btn:hover { color: ${BRAND.blue10}; }
.ro-tab-btn.active { color: ${BRAND.blue10}; border-bottom-color: ${BRAND.brightBlue}; }
.ro-seg { display: inline-flex; background: #EEEFF2; border-radius: 8px; padding: 2px; gap: 2px; }
.ro-seg-btn { border: none; cursor: pointer; font-family: ${FONT}; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; background: transparent; color: ${BRAND.mediumGray}; transition: all 0.15s ease; white-space: nowrap; }
.ro-seg-btn.active { background: ${BRAND.white}; color: ${BRAND.blue10}; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.ro-kpi { background: ${BRAND.white}; border: 1px solid ${UI.line}; border-radius: ${UI.radius}px; box-shadow: ${UI.shadow}; padding: 24px; }
.ro-kpi-value { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; color: ${BRAND.blue10}; margin: 8px 0 16px; line-height: 1.05; }
.ro-kpi-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; border-top: 1px solid ${UI.lineSoft}; padding-top: 14px; }
.ro-kpi-splits { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 8px; border-top: 1px solid ${UI.lineSoft}; padding-top: 14px; margin-top: 14px; }
.ro-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: ${BRAND.blue10}; background: rgba(0, 94, 255, 0.07); border-radius: 999px; padding: 4px 12px; }
.ro-clear-btn { margin-left: auto; align-self: flex-end; display: inline-flex; align-items: center; gap: 6px; background: ${BRAND.white}; border: 1px solid ${UI.line}; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; color: ${BRAND.mediumGray}; cursor: pointer; font-family: ${FONT}; white-space: nowrap; transition: all 0.15s ease; }
.ro-clear-btn:hover:not(:disabled) { color: ${BRAND.blue10}; border-color: ${BRAND.brightBlue}; }
.ro-clear-btn:disabled { opacity: 0.45; cursor: default; }
`;

/* ============================================================================
   UI PRIMITIVES
============================================================================ */

function Panel({ title, children, action }) {
  return (
    <div className="ro-card">
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 24px 14px", flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", color: BRAND.blue10 }}>{title}</h3>
          {action}
        </div>
      )}
      <div style={{ padding: "0 24px 24px" }}>{children}</div>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="ro-label">{label}</span>
      <select className="ro-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ options, active, onChange }) {
  return (
    <div className="ro-seg">
      {options.map((o) => (
        <button
          key={o}
          className={`ro-seg-btn${o === active ? " active" : ""}`}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function ClearFiltersButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      className="ro-clear-btn"
      onClick={onClick}
      disabled={disabled}
      title="Reset filters to their defaults"
    >
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>×</span>
      Clear filters
    </button>
  );
}

function TabsBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", overflowX: "auto" }}>
      {tabs.map((t) => (
        <button
          key={t}
          className={`ro-tab-btn${t === active ? " active" : ""}`}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

const tooltipStyle = {
  background: BRAND.white,
  border: `1px solid ${UI.line}`,
  borderRadius: 8,
  fontSize: 12,
  fontFamily: FONT,
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
};

/* Minimal table header cell */
const thMin = {
  padding: "10px 12px",
  textAlign: "right",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: BRAND.mediumGray,
  borderBottom: `1px solid ${UI.line}`,
  whiteSpace: "nowrap",
};
const tdNum = { padding: "9px 12px", textAlign: "right" };

/* ============================================================================
   KPI CARD — left rail on LOB Summary
============================================================================ */

function KpiCard({ title, value, stats, splits }) {
  return (
    <div className="ro-kpi">
      <div className="ro-label">{title}</div>
      <div className="ro-kpi-value">{value}</div>
      <div className="ro-kpi-stats">
        {stats.map((s) => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: BRAND.brightBlue }}>{s.value}</div>
            <div style={{ fontSize: 11, color: BRAND.mediumGray, marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {splits && splits.length > 0 && (
        <div className="ro-kpi-splits">
          {splits.map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: BRAND.blue10 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: BRAND.mediumGray, marginTop: 3 }}>{s.label}</div>
              {s.sub && (
                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 3, color: varColor(s.subRaw ?? 0) }}>
                  {s.sub}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   STACKED LOB CHART — shared by revenue ($M) and issuance ($B)
============================================================================ */

function StackedLobChart({ data, lobs }) {
  const segmentLabel = (lobName) => (props) => {
    const { x, y, width, height, value } = props;
    if (lobName === "Other MR") return null;
    if (!value || height < 14) return null;
    return (
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fill: lobName === "SFG" ? BRAND.black : BRAND.white,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: FONT,
        }}
      >
        {Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}
      </text>
    );
  };

  return (
    <div style={{ width: "100%", height: 340 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 30, right: 8, left: 8, bottom: 4 }} barCategoryGap="30%">
          <CartesianGrid stroke={UI.lineSoft} vertical={false} />
          <XAxis dataKey="name" stroke={BRAND.mediumGray} fontSize={12} tickLine={false} axisLine={{ stroke: UI.line }} />
          <YAxis hide />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, n) => [Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }), n]}
            cursor={{ fill: "rgba(0, 0, 0, 0.03)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12, fontFamily: FONT }} iconType="circle" iconSize={8} />
          {lobs.map((l, i) => (
            <Bar key={l} dataKey={l} name={l} stackId="stack" fill={LOB_COLORS[l]}>
              <LabelList dataKey={l} content={segmentLabel(l)} />
              {i === lobs.length - 1 && (
                <LabelList
                  dataKey="totalDisplay"
                  position="top"
                  formatter={(v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  style={{ fill: BRAND.blue10, fontSize: 12, fontWeight: 700, fontFamily: FONT }}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================================================================
   SUMMARY VARIANCE TABLE — Fcst | PY | Δ | Δ% | Bud | Bud vs PY %
============================================================================ */

function SummaryVarianceTable({ labelHeader, rows, total, fmt, expanded, onToggle }) {
  const renderRow = (r, isTotal) => {
    const isLob = r.level === "lob";
    const fcstVsPy = r.fcst - r.py;
    const fcstVsPyPct = pctChange(r.fcst, r.py);
    const budVsPyPct = pctChange(r.bud, r.py);
    return (
      <tr
        key={r.key}
        className={isTotal ? undefined : "ro-hover"}
        style={
          isTotal
            ? { borderTop: `2px solid ${BRAND.blue10}`, background: "#F7F8FA", color: BRAND.blue10, fontWeight: 700 }
            : {
                borderBottom: `1px solid ${UI.lineSoft}`,
                background: r.level === "sub" ? "#FAFBFC" : BRAND.white,
                fontWeight: isLob ? 600 : 400,
              }
        }
      >
        <td
          className={!isTotal && r.canExpand ? "ro-expand" : undefined}
          style={{
            padding: isTotal ? "11px 12px" : "9px 12px",
            whiteSpace: "nowrap",
            color: isTotal || isLob ? BRAND.blue10 : BRAND.darkGray,
            paddingLeft: r.level === "sub" ? 28 : 12,
            fontSize: 13,
          }}
          onClick={() => !isTotal && r.canExpand && onToggle(r.label)}
        >
          {!isTotal && r.canExpand && (
            <span style={{ marginRight: 6, color: BRAND.mediumGray }}>{expanded[r.label] ? "−" : "+"}</span>
          )}
          {r.label}
        </td>
        <td style={{ ...tdNum, fontSize: 13 }}>{fmt(r.fcst)}</td>
        <td style={{ ...tdNum, fontSize: 13 }}>{fmt(r.py)}</td>
        <td style={{ ...tdNum, fontSize: 13, fontWeight: 500, color: isTotal ? BRAND.blue10 : varColor(fcstVsPy) }}>{fmt(fcstVsPy)}</td>
        <td style={{ ...tdNum, fontSize: 13, fontWeight: 600, color: isTotal ? BRAND.blue10 : varColor(fcstVsPyPct), background: isTotal ? "transparent" : varBg(fcstVsPyPct) }}>
          {!isTotal && <span style={{ fontSize: 8, marginRight: 4 }}>{varArrow(fcstVsPyPct)}</span>}
          {fmtPct(fcstVsPyPct)}
        </td>
        <td style={{ ...tdNum, fontSize: 13 }}>{fmt(r.bud)}</td>
        <td style={{ ...tdNum, fontSize: 13, fontWeight: 600, color: isTotal ? BRAND.blue10 : varColor(budVsPyPct), background: isTotal ? "transparent" : varBg(budVsPyPct) }}>
          {!isTotal && <span style={{ fontSize: 8, marginRight: 4 }}>{varArrow(budVsPyPct)}</span>}
          {fmtPct(budVsPyPct)}
        </td>
      </tr>
    );
  };

  return (
    <div className="ro-scroll-x">
      <table className="ro-table" style={{ minWidth: 680 }}>
        <thead>
          <tr>
            <th style={{ ...thMin, textAlign: "left" }}>{labelHeader}</th>
            <th style={thMin}>Fcst</th>
            <th style={thMin}>PY</th>
            <th style={thMin}>Fcst vs PY</th>
            <th style={thMin}>Fcst vs PY %</th>
            <th style={thMin}>Bud</th>
            <th style={thMin}>Bud vs PY %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => renderRow(r, false))}
          {total && renderRow(total, true)}
        </tbody>
      </table>
    </div>
  );
}

/* Builds LOB rows (+ visible sub rows) for a SummaryVarianceTable. */
function buildSummaryRows({ rows, lobs, subsForLob, measure, cutoffMonth, expanded }) {
  const calc = (subset) => ({
    fcst: sumBy(subset, (r) => blendedValue(r, CURRENT_YEAR, measure, cutoffMonth)),
    py: sumBy(subset, (r) => (r.year === CURRENT_YEAR - 1 ? measure.act(r) : 0)),
    bud: sumBy(subset, (r) => (r.year === CURRENT_YEAR ? measure.bud(r) : 0)),
  });

  const out = [];
  lobs.forEach((l) => {
    const lobRows = rows.filter((r) => r.lob === l);
    const subs = subsForLob(l);
    out.push({ label: l, key: l, level: "lob", canExpand: subs.length > 1, ...calc(lobRows) });
    if (expanded[l]) {
      subs.forEach((s) => {
        const c = calc(lobRows.filter((r) => r.subLob === s));
        if (c.fcst || c.py || c.bud) out.push({ label: s, key: `${l}|${s}`, level: "sub", ...c });
      });
    }
  });
  return out;
}

/* ============================================================================
   LOB SUMMARY TAB
============================================================================ */

function SummaryTab({ revRows, issRows, revCutoff, issCutoffs }) {
  const [region, setRegion] = useState("All");
  const [quarter, setQuarter] = useState("All");
  const [billType, setBillType] = useState("All");
  const [jv, setJv] = useState("All");
  const [revExpanded, setRevExpanded] = useState({});
  const [issExpanded, setIssExpanded] = useState({});
  const [issMeasureName, setIssMeasureName] = useState(ISS_MEASURES[0].name);

  const issMeasure = ISS_MEASURES.find((m) => m.name === issMeasureName) ?? ISS_MEASURES[0];
  const issCutoff = issCutoffs[issMeasureName] ?? 0;
  const volMeasure = ISS_MEASURES[0];
  const volCutoff = issCutoffs[volMeasure.name] ?? 0;

  const revFiltered = useMemo(
    () => revRows.filter((r) =>
      (region === "All" || r.region === region) &&
      (quarter === "All" || r.quarter === quarter) &&
      (billType === "All" || r.transRecurring === billType) &&
      (jv === "All" || r.isJV === jv)
    ),
    [revRows, region, quarter, billType, jv]
  );

  const issFiltered = useMemo(
    () => issRows.filter((r) =>
      (region === "All" || r.region === region) &&
      (quarter === "All" || r.quarter === quarter)
    ),
    [issRows, region, quarter]
  );

  const issLobs = useMemo(
    () => LOB_ORDER.filter((l) => issRows.some((r) => r.lob === l)),
    [issRows]
  );

  const issSubsByLob = useMemo(() => {
    const map = {};
    issLobs.forEach((l) => {
      map[l] = canonicalSubs(l, uniq(issRows.filter((r) => r.lob === l).map((r) => r.subLob)));
    });
    return map;
  }, [issRows, issLobs]);

  /* ── Stacked charts ─────────────────────────────────────────────── */
  const buildStacked = (rows, lobs, measure, cutoff) => {
    const cols = [
      { name: "Act 2023", pick: (r) => (r.year === 2023 ? measure.act(r) : 0) },
      { name: "Act 2024", pick: (r) => (r.year === 2024 ? measure.act(r) : 0) },
      { name: "Act 2025", pick: (r) => (r.year === 2025 ? measure.act(r) : 0) },
      { name: "Bud 2026", pick: (r) => (r.year === CURRENT_YEAR ? measure.bud(r) : 0) },
      { name: "Fcst 2026", pick: (r) => blendedValue(r, CURRENT_YEAR, measure, cutoff) },
    ];
    return cols.map((c) => {
      const entry = { name: c.name, total: 0 };
      lobs.forEach((l) => {
        const v = sumBy(rows.filter((r) => r.lob === l), c.pick);
        entry[l] = measure.toDisplay(v);
        entry.total += v;
      });
      entry.totalDisplay = measure.toDisplay(entry.total);
      return entry;
    });
  };

  const revStacked = useMemo(
    () => buildStacked(revFiltered, LOB_ORDER, REV_MEASURE, revCutoff),
    [revFiltered, revCutoff]
  );
  const issStacked = useMemo(
    () => buildStacked(issFiltered, issLobs, volMeasure, volCutoff),
    [issFiltered, issLobs, volCutoff]
  );

  /* ── Summary tables ─────────────────────────────────────────────── */
  const revTableRows = useMemo(
    () => buildSummaryRows({
      rows: revFiltered, lobs: LOB_ORDER,
      subsForLob: (l) => SUB_LOB_BY_LOB[l] ?? [],
      measure: REV_MEASURE, cutoffMonth: revCutoff, expanded: revExpanded,
    }),
    [revFiltered, revCutoff, revExpanded]
  );
  const issTableRows = useMemo(
    () => buildSummaryRows({
      rows: issFiltered, lobs: issLobs,
      subsForLob: (l) => issSubsByLob[l] ?? [],
      measure: issMeasure, cutoffMonth: issCutoff, expanded: issExpanded,
    }),
    [issFiltered, issLobs, issSubsByLob, issMeasure, issCutoff, issExpanded]
  );

  const tableTotal = (rows, label) => ({
    label, key: "__total", level: "total",
    fcst: sumBy(rows.filter((r) => r.level === "lob"), (r) => r.fcst),
    py: sumBy(rows.filter((r) => r.level === "lob"), (r) => r.py),
    bud: sumBy(rows.filter((r) => r.level === "lob"), (r) => r.bud),
  });

  /* ── KPI cards ──────────────────────────────────────────────────── */
  const revKpis = useMemo(() => {
    const fcst = sumBy(revFiltered, (r) => blendedValue(r, CURRENT_YEAR, REV_MEASURE, revCutoff));
    const py = sumBy(revFiltered, (r) => (r.year === CURRENT_YEAR - 1 ? r.usdAmount : 0));
    const bud = sumBy(revFiltered, (r) => (r.year === CURRENT_YEAR ? r.usdBudgetBR : 0));
    const act3y = sumBy(revFiltered, (r) => (r.year === CURRENT_YEAR - 3 ? r.usdAmount : 0));
    const cagr = act3y > 0 && fcst > 0 ? (Math.pow(fcst / act3y, 1 / 3) - 1) * 100 : 0;
    const splits = BILL_TYPES.map((bt) => {
      const f = sumBy(revFiltered.filter((r) => r.transRecurring === bt), (r) => blendedValue(r, CURRENT_YEAR, REV_MEASURE, revCutoff));
      const p = sumBy(revFiltered.filter((r) => r.transRecurring === bt), (r) => (r.year === CURRENT_YEAR - 1 ? r.usdAmount : 0));
      const d = pctChange(f, p);
      return { label: bt, value: fmtInt(f / 1e6), sub: `${fmtPct(d)} vs PY`, subRaw: d };
    });
    return {
      value: `${fmtInt(fcst / 1e6)}M`,
      stats: [
        { value: fmtPct(pctChange(fcst, py)), label: "Fcst. Growth" },
        { value: fmtPct(pctChange(bud, py)), label: "Bud. Growth" },
        { value: fmtPct(cagr), label: "CAGR 3Y" },
      ],
      splits,
    };
  }, [revFiltered, revCutoff]);

  const issKpis = useMemo(() => {
    const m = volMeasure;
    const fcst = sumBy(issFiltered, (r) => blendedValue(r, CURRENT_YEAR, m, volCutoff));
    const py = sumBy(issFiltered, (r) => (r.year === CURRENT_YEAR - 1 ? m.act(r) : 0));
    const bud = sumBy(issFiltered, (r) => (r.year === CURRENT_YEAR ? m.bud(r) : 0));
    const act3y = sumBy(issFiltered, (r) => (r.year === CURRENT_YEAR - 3 ? m.act(r) : 0));
    const cagr = act3y > 0 && fcst > 0 ? (Math.pow(fcst / act3y, 1 / 3) - 1) * 100 : 0;
    const constructs = uniq(issRows.map((r) => r.pricing)).filter((pc) => pc !== "SFG").slice(0, 3);
    const splits = constructs.map((pc) => {
      const f = sumBy(issFiltered.filter((r) => r.pricing === pc), (r) => blendedValue(r, CURRENT_YEAR, m, volCutoff));
      const p = sumBy(issFiltered.filter((r) => r.pricing === pc), (r) => (r.year === CURRENT_YEAR - 1 ? m.act(r) : 0));
      const d = pctChange(f, p);
      return { label: pc, value: fmtInt(f / 1000), sub: `${fmtPct(d)} vs PY`, subRaw: d };
    });
    return {
      value: `${fmtInt(fcst / 1000)}bn`,
      stats: [
        { value: fmtPct(pctChange(fcst, py)), label: "Fcst. Growth" },
        { value: fmtPct(pctChange(bud, py)), label: "Bud. Growth" },
        { value: fmtPct(cagr), label: "CAGR 3Y" },
      ],
      splits,
    };
  }, [issFiltered, issRows, volCutoff]);

  const filtersActive = region !== "All" || quarter !== "All" || billType !== "All" || jv !== "All";
  const clearFilters = () => {
    setRegion("All");
    setQuarter("All");
    setBillType("All");
    setJv("All");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="ro-filters">
        <Select label="Region" value={region} onChange={setRegion} options={["All", ...REGION_ORDER]} />
        <Select label="Quarter" value={quarter} onChange={setQuarter} options={["All", ...QUARTERS]} />
        <Select label="Bill type" value={billType} onChange={setBillType} options={["All", ...BILL_TYPES]} />
        <Select label="Is JV" value={jv} onChange={setJv} options={["All", ...IS_JV]} />
        <ClearFiltersButton onClick={clearFilters} disabled={!filtersActive} />
      </div>

      <div className="ro-summary-layout">
        <div className="ro-side">
          <KpiCard title="Revenue ($M)" value={revKpis.value} stats={revKpis.stats} splits={revKpis.splits} />
          <KpiCard title="Issuance ($B)" value={issKpis.value} stats={issKpis.stats} splits={issKpis.splits} />
        </div>

        <div className="ro-summary-main">
          <Panel title="Ratings revenue ($M)">
            <StackedLobChart data={revStacked} lobs={LOB_ORDER} />
          </Panel>
          <Panel title="Ratings issuance ($B)">
            <StackedLobChart data={issStacked} lobs={issLobs} />
          </Panel>
          <Panel title="Revenue summary">
            <SummaryVarianceTable
              labelHeader="Revenue ($M)"
              rows={revTableRows}
              total={tableTotal(revTableRows, "Revenue")}
              fmt={REV_MEASURE.fmt}
              expanded={revExpanded}
              onToggle={(l) => setRevExpanded((e) => ({ ...e, [l]: !e[l] }))}
            />
          </Panel>
          <Panel
            title="Issuance and deals summary"
            action={<Toggle options={ISS_MEASURES.map((m) => m.name)} active={issMeasureName} onChange={setIssMeasureName} />}
          >
            <SummaryVarianceTable
              labelHeader={issMeasure.name === "Deals" ? "Deals" : "Rated issuance ($B)"}
              rows={issTableRows}
              total={tableTotal(issTableRows, issMeasure.name === "Deals" ? "Total deals" : "Rated issuance")}
              fmt={issMeasure.fmt}
              expanded={issExpanded}
              onToggle={(l) => setIssExpanded((e) => ({ ...e, [l]: !e[l] }))}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   VARIANCE PANEL — horizontal diverging bars per Sub-LOB (replaces heatmaps)
============================================================================ */

function VariancePanel({ title, items, measure }) {
  const [mode, setMode] = useState("vs PY");

  const data = useMemo(() => {
    return items
      .map((it) => {
        const base = mode === "vs PY" ? it.py : it.bud;
        const delta = measure.toDisplay(it.fcst - base);
        const pct = pctChange(it.fcst, base);
        return {
          label: it.label,
          delta,
          labelText: `${fmtSigned(delta)} (${pct > 0 ? "+" : ""}${pct.toFixed(0)}%)`,
        };
      })
      .filter((d) => d.delta !== 0 || items.length <= 2)
      .sort((a, b) => b.delta - a.delta);
  }, [items, mode, measure]);

  const divergingLabel = (props) => {
    const { x, y, width, height, index } = props;
    const d = data[index];
    if (!d) return null;
    const positive = d.delta >= 0;
    /* Anchor to the bar's outer edge regardless of how the renderer
       reports x/width for negative values. */
    const leftEdge = Math.min(x, x + width);
    const rightEdge = Math.max(x, x + width);
    return (
      <text
        x={positive ? rightEdge + 8 : leftEdge - 8}
        y={y + height / 2}
        textAnchor={positive ? "start" : "end"}
        dominantBaseline="central"
        style={{ fill: positive ? BRAND.low : BRAND.critical, fontSize: 12, fontWeight: 600, fontFamily: FONT }}
      >
        {d.labelText}
      </text>
    );
  };

  return (
    <Panel
      title={title}
      action={<Toggle options={["vs PY", "vs Bud"]} active={mode} onChange={setMode} />}
    >
      {data.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: BRAND.mediumGray, fontSize: 13 }}>
          No variance to display for the current selection.
        </div>
      ) : (
        <div style={{ width: "100%", height: Math.max(160, data.length * 42 + 40) }}>
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 110, left: 16, bottom: 8 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={150}
                stroke={BRAND.darkGray}
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <ReferenceLine x={0} stroke={UI.line} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [`${fmtSigned(v)} ${measure.unit}`, `Fcst ${mode}`]}
                cursor={{ fill: "rgba(0, 0, 0, 0.03)" }}
              />
              <Bar dataKey="delta" barSize={16} radius={[0, 4, 4, 0]}>
                {data.map((d) => (
                  <Cell key={d.label} fill={d.delta >= 0 ? BRAND.low : BRAND.critical} />
                ))}
                <LabelList content={divergingLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/* ============================================================================
   PHASING VIEW — shared by Revenue Phasing and Issuance Phasing
   extraFilters: [{ key, label, accessor, hideOption?, exempt? }]
   - hideOption: member removed from the dropdown (e.g. "SFG")
   - exempt(r): rows that always pass this filter (e.g. all SFG rows)
============================================================================ */

function PhasingView({ rows, lobs, subsForLob, measures, cutoffs, extraFilters, chartTitle }) {
  const [lob, setLob] = useState(lobs[0] ?? "All");
  const [region, setRegion] = useState("All");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [quarter, setQuarter] = useState("All");
  const [extra, setExtra] = useState(() => Object.fromEntries(extraFilters.map((f) => [f.key, "All"])));
  const [granularity, setGranularity] = useState("Monthly");
  const [measureName, setMeasureName] = useState(measures[0].name);
  const [expanded, setExpanded] = useState(() => (lobs[0] ? { [lobs[0]]: true } : {}));

  const measure = measures.find((m) => m.name === measureName) ?? measures[0];
  const cutoff = cutoffs[measure.name] ?? 0;
  const yearNum = Number(year);

  const extraOptions = useMemo(() => {
    const map = {};
    extraFilters.forEach((f) => {
      map[f.key] = ["All", ...uniq(rows.map(f.accessor)).filter((v) => v !== f.hideOption)];
    });
    return map;
  }, [rows, extraFilters]);

  const baseFiltered = useMemo(
    () => rows.filter((r) =>
      (region === "All" || r.region === region) &&
      (quarter === "All" || r.quarter === quarter) &&
      extraFilters.every((f) =>
        extra[f.key] === "All" ||
        (f.exempt && f.exempt(r)) ||
        f.accessor(r) === extra[f.key]
      )
    ),
    [rows, region, quarter, extra, extraFilters]
  );

  const lobFiltered = useMemo(
    () => baseFiltered.filter((r) => lob === "All" || r.lob === lob),
    [baseFiltered, lob]
  );

  const fcstMetric = (r) => blendedValue(r, yearNum, measure, cutoff);

  /* ── Chart: Fcst bars + Budget / PY lines ──────────────────────── */
  const chartData = useMemo(() => {
    const periods = granularity === "Monthly" ? MONTHS : QUARTERS;
    const idx = (r) => (granularity === "Monthly" ? r.monthNo - 1 : Number(r.quarter[1]) - 1);
    const out = periods.map((p) => ({ period: p, fcst: 0, budget: 0, py: 0 }));
    lobFiltered.forEach((r) => {
      const i = idx(r);
      out[i].fcst += fcstMetric(r);
      if (r.year === yearNum) out[i].budget += measure.bud(r);
      if (r.year === yearNum - 1) out[i].py += measure.act(r);
    });
    return out.map((d) => ({
      period: d.period,
      fcst: measure.toDisplay(d.fcst),
      budget: measure.toDisplay(d.budget),
      py: yearNum - 1 >= YEARS[0] ? measure.toDisplay(d.py) : null,
    }));
  }, [lobFiltered, yearNum, granularity, measure, cutoff]);

  /* ── Phasing table ─────────────────────────────────────────────── */
  const phasingTable = useMemo(() => {
    const lobsToShow = lob === "All" ? lobs : [lob];
    const result = [];
    const grand = { label: "Total", key: "__total", months: Array(12).fill(0), total: 0, level: "total" };

    lobsToShow.forEach((l) => {
      const lobRow = { label: l, key: l, months: Array(12).fill(0), total: 0, level: "lob" };
      const subRows = subsForLob(l).map((s) => ({
        label: s, key: `${l}|${s}`, months: Array(12).fill(0), total: 0, level: "sub",
      }));
      baseFiltered.forEach((r) => {
        if (r.lob !== l) return;
        const v = fcstMetric(r);
        if (!v) return;
        lobRow.months[r.monthNo - 1] += v;
        lobRow.total += v;
        grand.months[r.monthNo - 1] += v;
        grand.total += v;
        const sr = subRows.find((x) => x.label === r.subLob);
        if (sr) { sr.months[r.monthNo - 1] += v; sr.total += v; }
      });
      result.push(lobRow);
      if (expanded[l]) result.push(...subRows.filter((s) => s.total !== 0));
    });
    result.push(grand);
    return result;
  }, [baseFiltered, lob, lobs, subsForLob, yearNum, measure, cutoff, expanded]);

  /* ── Variance items (per Sub-LOB, or per LOB when "All") ───────── */
  const varianceItems = useMemo(() => {
    const groups = lob === "All"
      ? lobs.map((l) => ({ label: l, match: (r) => r.lob === l }))
      : subsForLob(lob).map((s) => ({ label: s, match: (r) => r.lob === lob && r.subLob === s }));
    return groups
      .map((g) => {
        const subset = baseFiltered.filter(g.match);
        return {
          label: g.label,
          fcst: sumBy(subset, fcstMetric),
          py: sumBy(subset, (r) => (r.year === yearNum - 1 ? measure.act(r) : 0)),
          bud: sumBy(subset, (r) => (r.year === yearNum ? measure.bud(r) : 0)),
        };
      })
      .filter((g) => g.fcst || g.py || g.bud);
  }, [baseFiltered, lob, lobs, subsForLob, yearNum, measure, cutoff]);

  const filtersActive =
    region !== "All" ||
    quarter !== "All" ||
    Object.values(extra).some((v) => v !== "All");
  const clearFilters = () => {
    setRegion("All");
    setQuarter("All");
    setExtra(Object.fromEntries(extraFilters.map((f) => [f.key, "All"])));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="ro-filters">
        <Select label="LOB" value={lob} onChange={(v) => { setLob(v); if (v !== "All") setExpanded({ [v]: true }); }} options={["All", ...lobs]} />
        <Select label="Region" value={region} onChange={setRegion} options={["All", ...REGION_ORDER]} />
        <Select label="Year" value={year} onChange={setYear} options={YEARS.map(String)} />
        <Select label="Quarter" value={quarter} onChange={setQuarter} options={["All", ...QUARTERS]} />
        {extraFilters.map((f) => (
          <Select
            key={f.key}
            label={f.label}
            value={extra[f.key]}
            onChange={(v) => setExtra((e) => ({ ...e, [f.key]: v }))}
            options={extraOptions[f.key]}
          />
        ))}
        {measures.length > 1 && (
          <Select label="Measure" value={measureName} onChange={setMeasureName} options={measures.map((m) => m.name)} />
        )}
        <ClearFiltersButton onClick={clearFilters} disabled={!filtersActive} />
      </div>

      <Panel
        title={`${chartTitle} (${measure.unit})`}
        action={<Toggle options={["Monthly", "Quarterly"]} active={granularity} onChange={setGranularity} />}
      >
        <div className="ro-grid-2">
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={UI.lineSoft} vertical={false} />
                <XAxis dataKey="period" stroke={BRAND.mediumGray} fontSize={11} tickLine={false} axisLine={{ stroke: UI.line }} />
                <YAxis hide />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => (v === null ? "—" : Number(v).toFixed(0))} cursor={{ fill: "rgba(0, 0, 0, 0.03)" }} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: FONT }} iconType="circle" iconSize={8} />
                <Bar dataKey="fcst" name="Forecast" fill={BRAND.blue10} radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="fcst"
                    position="insideBottom"
                    formatter={(v) => (v ? Number(v).toFixed(0) : "")}
                    style={{ fill: BRAND.white, fontSize: 10, fontWeight: 600, fontFamily: FONT }}
                  />
                </Bar>
                <Line type="monotone" dataKey="budget" name="Budget" stroke={BRAND.teal} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="py" name="PY" stroke={BRAND.gold} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="ro-scroll-x">
            <table className="ro-table" style={{ fontSize: 11, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ ...thMin, textAlign: "left", padding: "8px 8px 8px 0" }}>LOB</th>
                  {MONTHS.map((m) => (
                    <th key={m} style={{ ...thMin, padding: "8px 4px" }}>{m}</th>
                  ))}
                  <th style={{ ...thMin, padding: "8px 0 8px 8px" }}>Total year</th>
                </tr>
              </thead>
              <tbody>
                {phasingTable.map((r) => {
                  const isLob = r.level === "lob";
                  const isTotal = r.level === "total";
                  const canExpand = isLob && subsForLob(r.label).length > 1;
                  return (
                    <tr
                      key={r.key}
                      className={isTotal ? undefined : "ro-hover"}
                      style={{
                        borderBottom: isTotal ? "none" : `1px solid ${UI.lineSoft}`,
                        borderTop: isTotal ? `2px solid ${BRAND.blue10}` : "none",
                        background: isTotal ? "#F7F8FA" : r.level === "sub" ? "#FAFBFC" : BRAND.white,
                        fontWeight: isLob || isTotal ? 600 : 400,
                      }}
                    >
                      <td
                        className={canExpand ? "ro-expand" : undefined}
                        style={{
                          padding: "7px 8px 7px 0",
                          whiteSpace: "nowrap",
                          color: isLob || isTotal ? BRAND.blue10 : BRAND.darkGray,
                          paddingLeft: r.level === "sub" ? 18 : 0,
                        }}
                        onClick={() => canExpand && setExpanded((e) => ({ ...e, [r.label]: !e[r.label] }))}
                      >
                        {canExpand && <span style={{ marginRight: 4, color: BRAND.mediumGray }}>{expanded[r.label] ? "−" : "+"}</span>}
                        {r.label}
                      </td>
                      {r.months.map((v, i) => (
                        <td key={i} style={{ padding: "7px 4px", textAlign: "right", color: v ? BRAND.black : UI.line }}>
                          {v ? measure.fmt(v) : "—"}
                        </td>
                      ))}
                      <td style={{ padding: "7px 0 7px 8px", textAlign: "right", fontWeight: 700, color: BRAND.blue10 }}>
                        {measure.fmt(r.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <VariancePanel
        title={`Variance drivers — ${lob === "All" ? "by LOB" : `${lob} by Sub-LOB`} (${measure.unit})`}
        items={varianceItems}
        measure={measure}
      />
    </div>
  );
}

/* ============================================================================
   OUTLOOK TABLE TAB — YTD actuals · YTG model + growth rate guidance
   Model table: Prior Year | Jan…Dec | Q1–Q4 | FY
   Guidance:    YTD / YTG / FY growth vs the same period of the prior year
   Scenario picks what fills the YTG months: current forecast or budget.
============================================================================ */

/* Like blendedValue, but the YTG months follow the selected scenario. */
function scenarioValue(r, yearNum, measure, cutoff, scenario) {
  if (r.year !== yearNum) return 0;
  if (yearNum === CURRENT_YEAR) {
    if (r.monthNo <= cutoff) return measure.act(r);
    return scenario === "Bud" ? measure.bud(r) : (measure.fcst(r) ?? 0);
  }
  return measure.act(r);
}

function GrowthGuidanceTable({ rows, lobs, subsForLob, measure, cutoff, yearNum, scenario }) {
  const [expanded, setExpanded] = useState({});

  const table = useMemo(() => {
    const calc = (subset) => {
      const val = (r) => scenarioValue(r, yearNum, measure, cutoff, scenario);
      const cyYTD = sumBy(subset, (r) => (r.monthNo <= cutoff ? val(r) : 0));
      const cyYTG = sumBy(subset, (r) => (r.monthNo > cutoff ? val(r) : 0));
      const pyYTD = sumBy(subset, (r) => (r.year === yearNum - 1 && r.monthNo <= cutoff ? measure.act(r) : 0));
      const pyYTG = sumBy(subset, (r) => (r.year === yearNum - 1 && r.monthNo > cutoff ? measure.act(r) : 0));
      return {
        ytd: pyYTD ? pctChange(cyYTD, pyYTD) : null,
        ytg: pyYTG ? pctChange(cyYTG, pyYTG) : null,
        fy: pyYTD + pyYTG ? pctChange(cyYTD + cyYTG, pyYTD + pyYTG) : null,
        empty: !(cyYTD || cyYTG || pyYTD || pyYTG),
      };
    };

    const out = [];
    lobs.forEach((l) => {
      const lobRows = rows.filter((r) => r.lob === l);
      const c = calc(lobRows);
      if (c.empty) return;
      const subs = subsForLob(l);
      out.push({ label: l, key: l, level: "lob", canExpand: subs.length > 1, ...c });
      if (expanded[l]) {
        subs.forEach((s) => {
          const sc = calc(lobRows.filter((r) => r.subLob === s));
          if (!sc.empty) out.push({ label: s, key: `${l}|${s}`, level: "sub", ...sc });
        });
      }
    });
    const total = { label: "Total", key: "__total", level: "total", ...calc(rows.filter((r) => lobs.includes(r.lob))) };
    return { rows: out, total };
  }, [rows, lobs, subsForLob, measure, cutoff, yearNum, scenario, expanded]);

  const pctCell = (v, isTotal, i) => (
    <td key={i} style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, fontSize: 12, color: v == null ? UI.line : isTotal ? BRAND.blue10 : varColor(v) }}>
      {v == null ? "—" : fmtPct(v)}
    </td>
  );

  const renderRow = (r) => {
    const isTotal = r.level === "total";
    const isLob = r.level === "lob";
    return (
      <tr
        key={r.key}
        className={isTotal ? undefined : "ro-hover"}
        style={{
          borderBottom: isTotal ? "none" : `1px solid ${UI.lineSoft}`,
          borderTop: isTotal ? `2px solid ${BRAND.blue10}` : "none",
          background: isTotal ? "#F7F8FA" : r.level === "sub" ? "#FAFBFC" : BRAND.white,
          fontWeight: isLob || isTotal ? 600 : 400,
        }}
      >
        <td
          className={!isTotal && r.canExpand ? "ro-expand" : undefined}
          style={{
            padding: "8px 10px 8px 8px",
            whiteSpace: "nowrap",
            fontSize: 12,
            color: isLob || isTotal ? BRAND.blue10 : BRAND.darkGray,
            paddingLeft: r.level === "sub" ? 24 : 8,
          }}
          onClick={() => !isTotal && r.canExpand && setExpanded((e) => ({ ...e, [r.label]: !e[r.label] }))}
        >
          {!isTotal && r.canExpand && <span style={{ marginRight: 4, color: BRAND.mediumGray }}>{expanded[r.label] ? "−" : "+"}</span>}
          {r.label}
        </td>
        {pctCell(r.ytd, isTotal, "ytd")}
        {pctCell(r.ytg, isTotal, "ytg")}
        {pctCell(r.fy, isTotal, "fy")}
      </tr>
    );
  };

  return (
    <div className="ro-scroll-x">
      <table className="ro-table" style={{ minWidth: 280 }}>
        <thead>
          <tr>
            <th style={{ ...thMin, textAlign: "left", padding: "8px" }}>LOB</th>
            <th style={{ ...thMin, padding: "8px 10px" }}>YTD</th>
            <th style={{ ...thMin, padding: "8px 10px" }}>YTG</th>
            <th style={{ ...thMin, padding: "8px 10px" }}>FY</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map(renderRow)}
          {renderRow(table.total)}
        </tbody>
      </table>
    </div>
  );
}

function ModelTable({ rows, lobs, subsForLob, measure, cutoff, yearNum, labelHeader, scenario }) {
  const [expanded, setExpanded] = useState({});

  const build = useMemo(() => {
    const calc = (subset) => {
      const months = Array(12).fill(0);
      subset.forEach((r) => {
        const v = scenarioValue(r, yearNum, measure, cutoff, scenario);
        if (v) months[r.monthNo - 1] += v;
      });
      const fy = months.reduce((a, b) => a + b, 0);
      const prior = sumBy(subset, (r) => (r.year === yearNum - 1 ? measure.act(r) : 0));
      const quarters = [0, 1, 2, 3].map((q) => months[q * 3] + months[q * 3 + 1] + months[q * 3 + 2]);
      return { months, fy, prior, quarters };
    };

    const out = [];
    const totalAgg = calc(rows.filter((r) => lobs.includes(r.lob)));
    lobs.forEach((l) => {
      const lobRows = rows.filter((r) => r.lob === l);
      const c = calc(lobRows);
      if (!c.fy && !c.prior) return;
      const subs = subsForLob(l);
      out.push({ label: l, key: l, level: "lob", canExpand: subs.length > 1, ...c });
      if (expanded[l]) {
        subs.forEach((s) => {
          const sc = calc(lobRows.filter((r) => r.subLob === s));
          if (sc.fy || sc.prior) out.push({ label: s, key: `${l}|${s}`, level: "sub", ...sc });
        });
      }
    });
    return { rows: out, total: { label: "Total", key: "__total", level: "total", ...totalAgg } };
  }, [rows, lobs, subsForLob, measure, cutoff, yearNum, scenario, expanded]);

  const renderRow = (r) => {
    const isTotal = r.level === "total";
    const isLob = r.level === "lob";
    return (
      <tr
        key={r.key}
        className={isTotal ? undefined : "ro-hover"}
        style={{
          borderBottom: isTotal ? "none" : `1px solid ${UI.lineSoft}`,
          borderTop: isTotal ? `2px solid ${BRAND.blue10}` : "none",
          background: isTotal ? "#F7F8FA" : r.level === "sub" ? "#FAFBFC" : BRAND.white,
          fontWeight: isLob || isTotal ? 600 : 400,
        }}
      >
        <td
          className={!isTotal && r.canExpand ? "ro-expand" : undefined}
          style={{
            padding: "7px 8px",
            whiteSpace: "nowrap",
            color: isLob || isTotal ? BRAND.blue10 : BRAND.darkGray,
            paddingLeft: r.level === "sub" ? 24 : 8,
            position: "sticky",
            left: 0,
            background: "inherit",
          }}
          onClick={() => !isTotal && r.canExpand && setExpanded((e) => ({ ...e, [r.label]: !e[r.label] }))}
        >
          {!isTotal && r.canExpand && <span style={{ marginRight: 4, color: BRAND.mediumGray }}>{expanded[r.label] ? "−" : "+"}</span>}
          {r.label}
        </td>
        <td style={{ padding: "7px 6px", textAlign: "right", color: BRAND.mediumGray }}>{measure.fmt(r.prior)}</td>
        {r.months.map((v, i) => {
          const isFcstMonth = yearNum === CURRENT_YEAR && i + 1 > cutoff;
          return (
            <td key={i} style={{ padding: "7px 4px", textAlign: "right", color: v ? (isFcstMonth ? BRAND.mediumGray : BRAND.black) : UI.line }}>
              {v ? measure.fmt(v) : "—"}
            </td>
          );
        })}
        {r.quarters.map((v, i) => (
          <td key={`q${i}`} style={{ padding: "7px 6px", textAlign: "right", fontWeight: 600, background: isTotal ? "transparent" : "#FAFBFC", borderLeft: i === 0 ? `1px solid ${UI.line}` : "none" }}>
            {v ? measure.fmt(v) : "—"}
          </td>
        ))}
        <td style={{ padding: "7px 8px 7px 6px", textAlign: "right", fontWeight: 700, color: BRAND.blue10, borderLeft: `1px solid ${UI.line}` }}>
          {measure.fmt(r.fy)}
        </td>
      </tr>
    );
  };

  return (
    <div className="ro-scroll-x">
      <table className="ro-table" style={{ fontSize: 11, minWidth: 1020 }}>
        <thead>
          <tr>
            <th style={{ ...thMin, textAlign: "left", padding: "8px" }}>{labelHeader}</th>
            <th style={{ ...thMin, padding: "8px 6px" }}>Prior year</th>
            {MONTHS.map((m) => (
              <th key={m} style={{ ...thMin, padding: "8px 4px" }}>{m}</th>
            ))}
            {QUARTERS.map((q, i) => (
              <th key={q} style={{ ...thMin, padding: "8px 6px", borderLeft: i === 0 ? `1px solid ${UI.line}` : "none" }}>{q}</th>
            ))}
            <th style={{ ...thMin, padding: "8px 8px 8px 6px", borderLeft: `1px solid ${UI.line}` }}>FY</th>
          </tr>
        </thead>
        <tbody>
          {build.rows.map(renderRow)}
          {renderRow(build.total)}
        </tbody>
      </table>
    </div>
  );
}

function OutlookTableTab({ revRows, issRows, revCutoff, issCutoffs, issLobs, issSubsByLob }) {
  const [region, setRegion] = useState("All");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [scenario, setScenario] = useState("Fcst");
  const [monthSel, setMonthSel] = useState("Auto");
  const [issMeasureName, setIssMeasureName] = useState(ISS_MEASURES[0].name);

  const yearNum = Number(year);
  const issMeasure = ISS_MEASURES.find((m) => m.name === issMeasureName) ?? ISS_MEASURES[0];

  /* Month override: "Auto" follows the data cutoff; an explicit month never
     exceeds the months of actuals that actually exist for the current year. */
  const selIdx = monthSel === "Auto" ? null : MONTHS.indexOf(monthSel) + 1;
  const cutoffFor = (dsCutoff) => {
    if (yearNum === CURRENT_YEAR) return selIdx == null ? dsCutoff : Math.min(selIdx, dsCutoff);
    return selIdx == null ? (dsCutoff || 12) : selIdx;
  };
  const revCut = cutoffFor(revCutoff);
  const issCut = cutoffFor(issCutoffs[issMeasureName] ?? 0);

  const revFiltered = useMemo(
    () => revRows.filter((r) => region === "All" || r.region === region),
    [revRows, region]
  );
  const issFiltered = useMemo(
    () => issRows.filter((r) => region === "All" || r.region === region),
    [issRows, region]
  );

  const ytdChip = (cutoff) => (
    <span className="ro-chip">Year to date: {cutoff > 0 ? MONTHS[cutoff - 1] : "—"}</span>
  );

  const filtersActive = region !== "All" || monthSel !== "Auto";
  const clearFilters = () => {
    setRegion("All");
    setMonthSel("Auto");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="ro-filters">
        <Select label="Region" value={region} onChange={setRegion} options={["All", ...REGION_ORDER]} />
        <Select label="Year" value={year} onChange={setYear} options={YEARS.map(String)} />
        <Select label="Scenario" value={scenario} onChange={setScenario} options={["Fcst", "Bud"]} />
        <Select label="YTD month" value={monthSel} onChange={setMonthSel} options={["Auto", ...MONTHS]} />
        <ClearFiltersButton onClick={clearFilters} disabled={!filtersActive} />
      </div>

      <div className="ro-model-grid">
        <Panel title="Revenue — YTD actuals · YTG model ($M)" action={ytdChip(revCut)}>
          <ModelTable
            rows={revFiltered}
            lobs={LOB_ORDER}
            subsForLob={(l) => SUB_LOB_BY_LOB[l] ?? []}
            measure={REV_MEASURE}
            cutoff={revCut}
            yearNum={yearNum}
            scenario={scenario}
            labelHeader="Revenue ($M)"
          />
        </Panel>
        <Panel title="Growth rate guidance">
          <GrowthGuidanceTable
            rows={revFiltered}
            lobs={LOB_ORDER}
            subsForLob={(l) => SUB_LOB_BY_LOB[l] ?? []}
            measure={REV_MEASURE}
            cutoff={revCut}
            yearNum={yearNum}
            scenario={scenario}
          />
        </Panel>
      </div>

      <div className="ro-model-grid">
        <Panel
          title={`Issuance — YTD actuals · YTG model (${issMeasure.unit})`}
          action={
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {ytdChip(issCut)}
              <Toggle options={ISS_MEASURES.map((m) => m.name)} active={issMeasureName} onChange={setIssMeasureName} />
            </div>
          }
        >
          <ModelTable
            rows={issFiltered}
            lobs={issLobs}
            subsForLob={(l) => issSubsByLob[l] ?? []}
            measure={issMeasure}
            cutoff={issCut}
            yearNum={yearNum}
            scenario={scenario}
            labelHeader={issMeasure.name === "Deals" ? "Deal count" : "Issuance ($B)"}
          />
        </Panel>
        <Panel title="Growth rate guidance">
          <GrowthGuidanceTable
            rows={issFiltered}
            lobs={issLobs}
            subsForLob={(l) => issSubsByLob[l] ?? []}
            measure={issMeasure}
            cutoff={issCut}
            yearNum={yearNum}
            scenario={scenario}
          />
        </Panel>
      </div>

      <div style={{ fontSize: 12, color: BRAND.mediumGray }}>
        Months in black are actuals; months in gray are YTG filled with the selected scenario (current forecast or budget). Growth rate guidance compares YTD, YTG, and FY against the same period of the prior year.
      </div>
    </div>
  );
}

/* ============================================================================
   PERFORMANCE TAB — regional view
============================================================================ */

function PerformanceTab({ revRows, issRows, revCutoff, issCutoffs }) {
  const [dataset, setDataset] = useState("Revenue");
  const [lob, setLob] = useState("All");
  const [quarter, setQuarter] = useState("All");

  const isRevenue = dataset === "Revenue";
  const measure = isRevenue ? REV_MEASURE : ISS_MEASURES[0];
  const cutoff = isRevenue ? revCutoff : (issCutoffs[ISS_MEASURES[0].name] ?? 0);
  const rows = isRevenue ? revRows : issRows;

  const filtered = useMemo(
    () => rows.filter((r) =>
      (lob === "All" || r.lob === lob) &&
      (quarter === "All" || r.quarter === quarter)
    ),
    [rows, lob, quarter]
  );

  const regions = useMemo(
    () => REGION_ORDER.filter((rg) => rows.some((r) => r.region === rg)),
    [rows]
  );

  const regionData = useMemo(
    () => regions.map((rg) => {
      const subset = filtered.filter((r) => r.region === rg);
      const fcst = sumBy(subset, (r) => blendedValue(r, CURRENT_YEAR, measure, cutoff));
      const py = sumBy(subset, (r) => (r.year === CURRENT_YEAR - 1 ? measure.act(r) : 0));
      const bud = sumBy(subset, (r) => (r.year === CURRENT_YEAR ? measure.bud(r) : 0));
      return {
        label: rg, key: rg, level: "lob", canExpand: false,
        fcst, py, bud,
        fcstD: measure.toDisplay(fcst),
        budD: measure.toDisplay(bud),
        pyD: measure.toDisplay(py),
      };
    }).filter((d) => d.fcst || d.py || d.bud),
    [filtered, regions, measure, cutoff]
  );

  const total = {
    label: "Total", key: "__total", level: "total",
    fcst: sumBy(regionData, (d) => d.fcst),
    py: sumBy(regionData, (d) => d.py),
    bud: sumBy(regionData, (d) => d.bud),
  };

  const filtersActive = lob !== "All" || quarter !== "All";
  const clearFilters = () => {
    setLob("All");
    setQuarter("All");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="ro-filters">
        <Select label="LOB" value={lob} onChange={setLob} options={["All", ...LOB_ORDER]} />
        <Select label="Quarter" value={quarter} onChange={setQuarter} options={["All", ...QUARTERS]} />
        <ClearFiltersButton onClick={clearFilters} disabled={!filtersActive} />
      </div>

      <Panel
        title={`Regional performance (${measure.unit})`}
        action={<Toggle options={["Revenue", "Issuance"]} active={dataset} onChange={setDataset} />}
      >
        <div className="ro-grid-2">
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={regionData} margin={{ top: 20, right: 8, left: 8, bottom: 0 }} barCategoryGap="24%">
                <CartesianGrid stroke={UI.lineSoft} vertical={false} />
                <XAxis dataKey="label" stroke={BRAND.mediumGray} fontSize={11} tickLine={false} axisLine={{ stroke: UI.line }} />
                <YAxis hide />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })} cursor={{ fill: "rgba(0, 0, 0, 0.03)" }} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: FONT }} iconType="circle" iconSize={8} />
                <Bar dataKey="fcstD" name="Forecast" fill={BRAND.blue10} radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="fcstD"
                    position="top"
                    formatter={(v) => (v ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "")}
                    style={{ fill: BRAND.blue10, fontSize: 11, fontWeight: 700, fontFamily: FONT }}
                  />
                </Bar>
                <Bar dataKey="budD" name="Budget" fill={BRAND.teal} radius={[4, 4, 0, 0]} />
                <Bar dataKey="pyD" name="PY" fill={BRAND.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <SummaryVarianceTable
            labelHeader={`Region (${measure.unit})`}
            rows={regionData}
            total={total}
            fmt={measure.fmt}
            expanded={{}}
            onToggle={() => {}}
          />
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================================
   MAIN — Revenue outlook
============================================================================ */

const TABS = ["LOB Summary", "Revenue Phasing", "Issuance Phasing", "Performance", "Outlook Table"];

export default function RevenueOutlook() {
  const rev = useFabricRows(GET_REVENUE_DATA, REVENUE_ROOTS, mapRevenueRow);
  const iss = useFabricRows(GET_ISSUANCE_DATA, ISSUANCE_ROOTS, mapIssuanceRow);
  const [tab, setTab] = useState(TABS[0]);

  const revCutoff = useMemo(() => lastActualMonth(rev.rows, (r) => r.usdAmount), [rev.rows]);
  const issCutoffs = useMemo(() => ({
    [ISS_MEASURES[0].name]: lastActualMonth(iss.rows, (r) => r.volM),
    [ISS_MEASURES[1].name]: lastActualMonth(iss.rows, (r) => r.deals),
  }), [iss.rows]);

  const issLobs = useMemo(
    () => LOB_ORDER.filter((l) => iss.rows.some((r) => r.lob === l)),
    [iss.rows]
  );
  const issSubsByLob = useMemo(() => {
    const map = {};
    issLobs.forEach((l) => {
      map[l] = canonicalSubs(l, uniq(iss.rows.filter((r) => r.lob === l).map((r) => r.subLob)));
    });
    return map;
  }, [iss.rows, issLobs]);

  const loading = rev.loading || iss.loading;
  const fatalError = rev.error && iss.error;

  const centered = (msg, color) => (
    <div style={{ padding: 48, textAlign: "center", color }}>{msg}</div>
  );

  const renderTab = () => {
    if (tab === "LOB Summary") {
      return (
        <SummaryTab
          revRows={rev.rows}
          issRows={iss.rows}
          revCutoff={revCutoff}
          issCutoffs={issCutoffs}
        />
      );
    }
    if (tab === "Revenue Phasing") {
      if (rev.error) return centered("Could not load revenue data from Fabric. Check your sign-in, permissions, and GraphQL query.", BRAND.critical);
      return (
        <PhasingView
          rows={rev.rows}
          lobs={LOB_ORDER}
          subsForLob={(l) => SUB_LOB_BY_LOB[l] ?? []}
          measures={[REV_MEASURE]}
          cutoffs={{ [REV_MEASURE.name]: revCutoff }}
          extraFilters={[
            { key: "billType", label: "Bill type", accessor: (r) => r.transRecurring },
            { key: "jv", label: "Is JV", accessor: (r) => r.isJV },
          ]}
          chartTitle="Ratings revenue"
        />
      );
    }
    if (tab === "Issuance Phasing") {
      if (iss.error) return centered("Could not load issuance data from Fabric. Check your sign-in, permissions, and GraphQL query.", BRAND.critical);
      return (
        <PhasingView
          rows={iss.rows}
          lobs={issLobs}
          subsForLob={(l) => issSubsByLob[l] ?? []}
          measures={ISS_MEASURES}
          cutoffs={issCutoffs}
          extraFilters={[
            { key: "pricing", label: "Pricing construct", accessor: (r) => r.pricing, hideOption: "SFG", exempt: (r) => r.lob === "SFG" },
            { key: "product", label: "Product type", accessor: (r) => r.product, hideOption: "SFG", exempt: (r) => r.lob === "SFG" },
          ]}
          chartTitle="Ratings issuance"
        />
      );
    }
    if (tab === "Outlook Table") {
      return (
        <OutlookTableTab
          revRows={rev.rows}
          issRows={iss.rows}
          revCutoff={revCutoff}
          issCutoffs={issCutoffs}
          issLobs={issLobs}
          issSubsByLob={issSubsByLob}
        />
      );
    }
    return (
      <PerformanceTab
        revRows={rev.rows}
        issRows={iss.rows}
        revCutoff={revCutoff}
        issCutoffs={issCutoffs}
      />
    );
  };

  return (
    <div className="ro-root">
      <style>{SCOPED_CSS}</style>

      <header style={{ background: BRAND.white, borderBottom: `1px solid ${UI.line}` }}>
        <div className="ro-container">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "20px 0 6px" }}>
            <img src="/moodylogo2.png" alt="Moody's" style={{ height: 32, width: "auto" }} />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: BRAND.blue10 }}>
              Revenue Outlook
            </h1>
          </div>
          <TabsBar tabs={TABS} active={tab} onChange={setTab} />
        </div>
      </header>

      <div className="ro-container" style={{ paddingTop: 28 }}>
        <div style={{ marginBottom: 12 }}>
          {loading && centered("Loading data from Fabric…", BRAND.mediumGray)}
          {!loading && fatalError && centered("Could not load data from Fabric. Check your sign-in, permissions, and GraphQL queries.", BRAND.critical)}
          {!loading && !fatalError && rev.rows.length === 0 && iss.rows.length === 0 &&
            centered("No rows were returned from Fabric for the current queries.", BRAND.mediumGray)}
          {!loading && !fatalError && (rev.rows.length > 0 || iss.rows.length > 0) && renderTab()}
        </div>

        <div style={{ fontSize: 12, paddingBottom: 32, textAlign: "right", color: BRAND.mediumGray }}>
          **All Fcst data in this dashboard is a projection of YTD actuals + YTG budget / current forecast
        </div>
      </div>
    </div>
  );
}
