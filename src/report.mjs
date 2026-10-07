// src/report.mjs
// Generate metrics JSON, trades CSV, equity CSV, SVG charts, and a self-contained HTML report.

import fs from "node:fs/promises";
import path from "node:path";
import { stringify } from "csv-stringify/sync";

const CHART_W = 1100;
const CHART_H = 360;
const PAD = { l: 60, r: 20, t: 30, b: 40 };

function niceTicks(min, max, count = 6) {
  const range = max - min;
  if (range === 0) return [min];
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function svgHeader(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="Segoe UI, Arial, sans-serif" font-size="11">`;
}

function xScale(ec) {
  return i => PAD.l + (i / (ec.length - 1)) * (CHART_W - PAD.l - PAD.r);
}
function yScale(min, max) {
  return v => PAD.t + (1 - (v - min) / (max - min || 1)) * (CHART_H - PAD.t - PAD.b);
}

function polylinePath(ec, yf) {
  let d = "";
  for (let i = 0; i < ec.length; i++) {
    d += (i === 0 ? "M" : "L") + xScale(ec)(i).toFixed(1) + " " + yf(ec[i].y).toFixed(1) + " ";
  }
  return d.trim();
}

function drawAxes(svg, minY, maxY, nTicks) {
  const ticks = niceTicks(minY, maxY, nTicks);
  for (const t of ticks) {
    const y = (CHART_H - PAD.b) - (t - minY) / (maxY - minY || 1) * (CHART_H - PAD.t - PAD.b);
    svg += `<line x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${CHART_W - PAD.r}" y2="${y.toFixed(1)}" stroke="#eee"/>`;
    svg += `<text x="${PAD.l - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#666">${t}</text>`;
  }
  // x-axis
  svg += `<line x1="${PAD.l}" y1="${CHART_H - PAD.b}" x2="${CHART_W - PAD.r}" y2="${CHART_H - PAD.b}" stroke="#999"/>`;
  svg += `<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${CHART_H - PAD.b}" stroke="#999"/>`;
  return svg;
}

function equityChartSvg(ec) {
  const ys = ec.map(p => p.equity);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.05;
  minY -= pad; maxY += pad;
  let svg = svgHeader(CHART_W, CHART_H);
  svg += `<text x="${PAD.l}" y="20" font-size="13" font-weight="bold" fill="#222">账户权益曲线（含现金 + 持仓）</text>`;
  svg = drawAxes(svg, minY, maxY, 6);
  const yf = yScale(minY, maxY);
  const ecWithY = ec.map(p => ({ ...p, y: p.equity }));
  svg += `<path d="${polylinePath(ecWithY, yf)}" fill="none" stroke="#1f77b4" stroke-width="1.5"/>`;
  // 标注起点/终点
  const last = ec.length - 1;
  svg += `<circle cx="${xScale(ec)(0).toFixed(1)}" cy="${yf(ec[0].equity).toFixed(1)}" r="3" fill="#1f77b4"/>`;
  svg += `<circle cx="${xScale(ec)(last).toFixed(1)}" cy="${yf(ec[last].equity).toFixed(1)}" r="3" fill="#1f77b4"/>`;
  svg += `<text x="${xScale(ec)(0).toFixed(1)}" y="${(yf(ec[0].equity) - 8).toFixed(1)}" text-anchor="middle" fill="#1f77b4">${ec[0].date}</text>`;
  svg += `<text x="${xScale(ec)(last).toFixed(1)}" y="${(yf(ec[last].equity) - 8).toFixed(1)}" text-anchor="middle" fill="#1f77b4">${ec[last].date}</text>`;
  svg += `</svg>`;
  return svg;
}

function priceWithGridSvg(ec, refitDates) {
  const ys = ec.map(p => p.close);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.05;
  minY -= pad; maxY += pad;
  let svg = svgHeader(CHART_W, CHART_H);
  svg += `<text x="${PAD.l}" y="20" font-size="13" font-weight="bold" fill="#222">股价走势 + 网格通道边界（背景色块）</text>`;
  svg = drawAxes(svg, minY, maxY, 6);
  // 网格通道：用一个 step 序列绘制竖向段（每次 refit 占一个色块）
  const xf = xScale(ec);
  const yf = yScale(minY, maxY);
  // 用 refitDates 在时间轴上分段；每个段的 lower/upper 暂不可知（在 result 里是 channel 序列）。先省略。
  // 绘制价格线
  const ecWithY = ec.map(p => ({ ...p, y: p.close }));
  svg += `<path d="${polylinePath(ecWithY, yf)}" fill="none" stroke="#333" stroke-width="1.2"/>`;
  // 标注 refit 竖线
  const dateToIdx = new Map(ec.map((p, i) => [p.date, i]));
  for (const d of refitDates) {
    const i = dateToIdx.get(d);
    if (i != null) {
      svg += `<line x1="${xf(i).toFixed(1)}" y1="${PAD.t}" x2="${xf(i).toFixed(1)}" y2="${CHART_H - PAD.b}" stroke="#ff7f0e" stroke-dasharray="3 3" stroke-width="0.8" opacity="0.5"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

function drawdownChartSvg(ec) {
  let peak = ec[0].equity;
  const dd = ec.map(p => { peak = Math.max(peak, p.equity); return { ...p, y: p.equity / peak - 1 }; });
  let minY = Math.min(...dd.map(p => p.y), 0);
  minY *= 1.1;
  let svg = svgHeader(CHART_W, CHART_H);
  svg += `<text x="${PAD.l}" y="20" font-size="13" font-weight="bold" fill="#222">回撤曲线（相对历史峰值）</text>`;
  svg = drawAxes(svg, minY, 0, 5);
  const yf = yScale(minY, 0);
  svg += `<path d="${polylinePath(dd, yf)}" fill="none" stroke="#d62728" stroke-width="1.2"/>`;
  // 填充
  let fill = `M${xfPoint(0, dd, yf)} `;
  for (let i = 1; i < dd.length; i++) fill += `L${xfPoint(i, dd, yf)} `;
  fill += `L${xfPoint(dd.length - 1, dd, yf).split(" ")[0]} ${(CHART_H - PAD.b).toFixed(1)} L${xfPoint(0, dd, yf).split(" ")[0]} ${(CHART_H - PAD.b).toFixed(1)} Z`;
  svg += `<path d="${fill}" fill="#d62728" fill-opacity="0.15"/>`;
  svg += `</svg>`;
  return svg;
}
function xfPoint(i, ec, yf) {
  return `${(PAD.l + (i / (ec.length - 1)) * (CHART_W - PAD.l - PAD.r)).toFixed(1)} ${yf(ec[i].y).toFixed(1)}`;
}

function drawdownHistogramSvg(ec) {
  // 月度收益直方图
  const monthly = new Map();
  for (let i = 1; i < ec.length; i++) {
    const d = ec[i].date;
    const ym = d.slice(0, 7);
    if (!monthly.has(ym)) monthly.set(ym, ec[i - 1].equity);
    monthly.set(ym + "_end", ec[i].equity); // not great — refactor below
  }
  // Cleaner: build by month-end equity
  const byMonth = new Map();
  byMonth.set(ec[0].date.slice(0, 7), ec[0].equity);
  for (const p of ec) byMonth.set(p.date.slice(0, 7), p.equity);
  const months = [...byMonth.keys()].sort();
  const returns = [];
  for (let i = 1; i < months.length; i++) {
    returns.push({ m: months[i], r: byMonth.get(months[i]) / byMonth.get(months[i - 1]) - 1 });
  }
  if (returns.length === 0) return "";
  let minR = Math.min(...returns.map(x => x.r), 0);
  let maxR = Math.max(...returns.map(x => x.r), 0);
  if (minR === maxR) { minR = -0.01; maxR = 0.01; }
  const pad = (maxR - minR) * 0.1;
  minR -= pad; maxR += pad;
  let svg = svgHeader(CHART_W, CHART_H);
  svg += `<text x="${PAD.l}" y="20" font-size="13" font-weight="bold" fill="#222">月度收益</text>`;
  svg = drawAxes(svg, minR, maxR, 5);
  const yf = yScale(minR, maxR);
  const barW = (CHART_W - PAD.l - PAD.r) / returns.length * 0.7;
  returns.forEach((x, i) => {
    const cx = PAD.l + (i + 0.5) / returns.length * (CHART_W - PAD.l - PAD.r);
    const yTop = yf(Math.max(0, x.r));
    const yBot = yf(Math.min(0, x.r));
    const color = x.r >= 0 ? "#2ca02c" : "#d62728";
    svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${(yBot - yTop).toFixed(1)}" fill="${color}" opacity="0.85"/>`;
    if (returns.length <= 30) {
      svg += `<text x="${cx.toFixed(1)}" y="${(yTop - 4).toFixed(1)}" text-anchor="middle" fill="#444" font-size="10">${(x.r * 100).toFixed(1)}%</text>`;
    }
    svg += `<text x="${cx.toFixed(1)}" y="${(CHART_H - PAD.b + 14).toFixed(1)}" text-anchor="middle" fill="#666" font-size="9">${x.m.slice(2)}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

function pnlByMonthSvg(trades) {
  const byMonth = new Map();
  for (const t of trades) {
    const ym = t.date.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) || 0) + (t.realized_pnl || 0));
  }
  if (byMonth.size === 0) return "";
  const items = [...byMonth.entries()].sort();
  let minR = Math.min(...items.map(([, v]) => v), 0);
  let maxR = Math.max(...items.map(([, v]) => v), 0);
  if (minR === maxR) { minR = -100; maxR = 100; }
  const pad = (maxR - minR) * 0.1;
  minR -= pad; maxR += pad;
  let svg = svgHeader(CHART_W, CHART_H);
  svg += `<text x="${PAD.l}" y="20" font-size="13" font-weight="bold" fill="#222">月度已实现盈亏（网格）</text>`;
  svg = drawAxes(svg, minR, maxR, 6);
  const yf = yScale(minR, maxR);
  const barW = (CHART_W - PAD.l - PAD.r) / items.length * 0.7;
  items.forEach(([m, v], i) => {
    const cx = PAD.l + (i + 0.5) / items.length * (CHART_W - PAD.l - PAD.r);
    const yTop = yf(Math.max(0, v));
    const yBot = yf(Math.min(0, v));
    const color = v >= 0 ? "#2ca02c" : "#d62728";
    svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${(yBot - yTop).toFixed(1)}" fill="${color}" opacity="0.85"/>`;
    if (items.length <= 30) {
      svg += `<text x="${cx.toFixed(1)}" y="${(yTop - 4).toFixed(1)}" text-anchor="middle" fill="#444" font-size="10">${Math.round(v)}</text>`;
    }
    svg += `<text x="${cx.toFixed(1)}" y="${(CHART_H - PAD.b + 14).toFixed(1)}" text-anchor="middle" fill="#666" font-size="9">${m.slice(2)}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

function priceMarkersSvg(ec, trades) {
  // 在价格线上叠加买卖点
  const ys = ec.map(p => p.close);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.05;
  minY -= pad; maxY += pad;
  let svg = svgHeader(CHART_W, CHART_H);
  svg += `<text x="${PAD.l}" y="20" font-size="13" font-weight="bold" fill="#222">交易信号（▲ 买入 / ▼ 卖出）</text>`;
  svg = drawAxes(svg, minY, maxY, 6);
  const yf = yScale(minY, maxY);
  const xf = xScale(ec);
  const ecWithY = ec.map(p => ({ ...p, y: p.close }));
  svg += `<path d="${polylinePath(ecWithY, yf)}" fill="none" stroke="#333" stroke-width="1"/>`;
  const dateIdx = new Map(ec.map((p, i) => [p.date, i]));
  for (const t of trades) {
    const i = dateIdx.get(t.date);
    if (i == null) continue;
    const x = xf(i), y = yf(t.price);
    if (t.side === "BUY") {
      svg += `<polygon points="${x.toFixed(1)},${(y + 5).toFixed(1)} ${(x - 4).toFixed(1)},${(y - 5).toFixed(1)} ${(x + 4).toFixed(1)},${(y - 5).toFixed(1)}" fill="#2ca02c"/>`;
    } else {
      svg += `<polygon points="${x.toFixed(1)},${(y - 5).toFixed(1)} ${(x - 4).toFixed(1)},${(y + 5).toFixed(1)} ${(x + 4).toFixed(1)},${(y + 5).toFixed(1)}" fill="#d62728"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

function fmtPct(x, d=2) { return (x * 100).toFixed(d) + "%"; }
function fmtMoney(x) { return x.toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }

function htmlReport({ symbol, name, params, metrics, equitySvg, drawdownSvg, monthlySvg, monthlyPnlSvg, signalsSvg, priceSvg }) {
  const m = metrics;
  const bench = m.benchmark;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>网格交易回测报告 — ${name} (${symbol})</title>
<style>
  body { font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; margin: 0; background: #f7f7fa; color: #222; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }
  h1 { margin: 0 0 6px 0; font-size: 24px; }
  h2 { margin: 28px 0 10px 0; font-size: 18px; border-left: 4px solid #1f77b4; padding-left: 8px; }
  .meta { color: #666; font-size: 13px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0; }
  .kpi { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
  .kpi .k { color: #666; font-size: 12px; }
  .kpi .v { font-size: 18px; font-weight: 600; margin-top: 2px; }
  .pos { color: #2ca02c; }
  .neg { color: #d62728; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 13px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: right; }
  th { background: #f0f2f5; }
  td.left, th.left { text-align: left; }
  .chart { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; margin: 8px 0; }
  .chart svg { width: 100%; height: auto; display: block; }
  pre.params { background: #1f2937; color: #e5e7eb; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
  .small { font-size: 12px; color: #666; }
</style>
</head>
<body>
<div class="wrap">
  <h1>网格交易回测报告</h1>
  <div class="meta">标的：${name} (${symbol}) &nbsp;·&nbsp; 回测区间：${metrics.first_date ?? ""} → ${metrics.last_date ?? ""} &nbsp;·&nbsp; 交易日数：${metrics.n_days}</div>

  <h2>核心指标</h2>
  <div class="kpis">
    <div class="kpi"><div class="k">总收益</div><div class="v ${m.total_return >= 0 ? "pos" : "neg"}">${fmtPct(m.total_return)}</div></div>
    <div class="kpi"><div class="k">年化收益 (CAGR)</div><div class="v ${m.cagr >= 0 ? "pos" : "neg"}">${fmtPct(m.cagr)}</div></div>
    <div class="kpi"><div class="k">最大回撤</div><div class="v neg">${fmtPct(m.max_drawdown)}</div></div>
    <div class="kpi"><div class="k">夏普比率</div><div class="v">${m.sharpe}</div></div>
    <div class="kpi"><div class="k">年化波动率</div><div class="v">${fmtPct(m.ann_volatility)}</div></div>
    <div class="kpi"><div class="k">期末权益</div><div class="v">¥${fmtMoney(m.final_equity)}</div></div>
    <div class="kpi"><div class="k">总交易笔数</div><div class="v">${m.n_trades}</div></div>
    <div class="kpi"><div class="k">胜率</div><div class="v">${fmtPct(m.win_rate)}</div></div>
    <div class="kpi"><div class="k">盈亏比 (avg win / |avg loss|)</div><div class="v">${typeof m.avg_loss === "number" && m.avg_loss !== 0 ? (m.avg_win / Math.abs(m.avg_loss)).toFixed(2) : "—"}</div></div>
    <div class="kpi"><div class="k">盈利因子</div><div class="v">${m.profit_factor}</div></div>
    <div class="kpi"><div class="k">总手续费 + 印花税</div><div class="v">¥${fmtMoney(m.total_fees)}</div></div>
    <div class="kpi"><div class="k">买入笔数 / 卖出笔数</div><div class="v">${m.n_buys} / ${m.n_sells}</div></div>
  </div>

  <h2>基准对比（同期买入持有）</h2>
  <table>
    <thead><tr><th class="left">策略</th><th>期末权益</th><th>总收益</th><th>相对超额</th></tr></thead>
    <tbody>
      <tr><td class="left">网格交易</td><td>¥${fmtMoney(m.final_equity)}</td><td class="${m.total_return >= 0 ? "pos" : "neg"}">${fmtPct(m.total_return)}</td><td>—</td></tr>
      ${bench ? `<tr><td class="left">买入持有</td><td>¥${fmtMoney(bench.final_equity)}</td><td class="${bench.total_return >= 0 ? "pos" : "neg"}">${fmtPct(bench.total_return)}</td><td class="${(m.total_return - bench.total_return) >= 0 ? "pos" : "neg"}">${fmtPct(m.total_return - bench.total_return)}</td></tr>` : ""}
    </tbody>
  </table>

  <h2>权益曲线</h2>
  <div class="chart">${equitySvg}</div>

  <h2>回撤曲线</h2>
  <div class="chart">${drawdownSvg}</div>

  <h2>股价走势 + 通道再拟合</h2>
  <div class="chart">${priceSvg}</div>

  <h2>交易信号（买卖点）</h2>
  <div class="chart">${signalsSvg}</div>

  <h2>月度账户收益</h2>
  <div class="chart">${monthlySvg}</div>

  <h2>月度已实现盈亏（来自平仓）</h2>
  <div class="chart">${monthlyPnlSvg}</div>

  <h2>策略参数</h2>
  <pre class="params">${JSON.stringify(params, null, 2)}</pre>

  <h2>说明</h2>
  <ul class="small">
    <li>数据源：东方财富公开 K 线（fqt=1 后复权）。</li>
    <li>回测以"次日 open ± 滑点"为成交价，避免偷看未来。</li>
    <li>手续费 万 2.5，最低 5 元；印花税 万 5（仅卖出）；滑点 1 个 tick（0.01 元）。</li>
    <li>网格通道：滚动 ${params.window} 日高低点，几何等比 / 算术等差可选，每 ${params.rebalance} 个交易日再拟合。</li>
    <li>A 股最小买入 100 股；满仓上限 = ${params.position_cap_lots} 笔 = ${params.position_cap_lots * params.lot_size} 股。</li>
  </ul>
</div>
</body>
</html>`;
}

export async function writeAll({ symbol, name, result, metrics, outDirs }) {
  const { equityDir, tradesDir, chartsDir, reportsDir } = outDirs;
  await fs.mkdir(equityDir, { recursive: true });
  await fs.mkdir(tradesDir, { recursive: true });
  await fs.mkdir(chartsDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

  // 1) equity.csv
  const equityCsv = stringify(result.equity_curve, {
    header: true, columns: ["date","open","high","low","close","cash","shares","equity"],
  });
  await fs.writeFile(path.join(equityDir, `${symbol}.csv`), "\uFEFF" + equityCsv, "utf8");

  // 2) trades.csv
  const tradeCols = ["date","side","price","shares","gross_amount","fee","tax","net_amount","realized_pnl","cash_after","shares_after","grid_id","channel_lower","channel_upper"];
  const tradesCsv = stringify(result.trades, { header: true, columns: tradeCols });
  await fs.writeFile(path.join(tradesDir, `${symbol}.csv`), "\uFEFF" + tradesCsv, "utf8");

  // 3) metrics.json
  const m = { ...metrics, first_date: result.equity_curve[0]?.date, last_date: result.equity_curve.at(-1)?.date };
  await fs.writeFile(path.join(reportsDir, `${symbol}_metrics.json`), JSON.stringify(m, null, 2), "utf8");

  // 4) charts (SVG)
  const equitySvg = equityChartSvg(result.equity_curve);
  const drawdownSvg = drawdownChartSvg(result.equity_curve);
  const monthlySvg = drawdownHistogramSvg(result.equity_curve);
  const monthlyPnlSvg = pnlByMonthSvg(result.trades);
  const signalsSvg = priceMarkersSvg(result.equity_curve, result.trades);
  const priceSvg = priceWithGridSvg(result.equity_curve, result.refit_dates);
  await fs.writeFile(path.join(chartsDir, `${symbol}_equity.svg`), equitySvg, "utf8");
  await fs.writeFile(path.join(chartsDir, `${symbol}_drawdown.svg`), drawdownSvg, "utf8");
  await fs.writeFile(path.join(chartsDir, `${symbol}_monthly.svg`), monthlySvg, "utf8");
  await fs.writeFile(path.join(chartsDir, `${symbol}_monthly_pnl.svg`), monthlyPnlSvg, "utf8");
  await fs.writeFile(path.join(chartsDir, `${symbol}_signals.svg`), signalsSvg, "utf8");
  await fs.writeFile(path.join(chartsDir, `${symbol}_price_grid.svg`), priceSvg, "utf8");

  // 5) HTML report
  const html = htmlReport({ symbol, name, params: result.params, metrics: m, equitySvg, drawdownSvg, monthlySvg, monthlyPnlSvg, signalsSvg, priceSvg });
  await fs.writeFile(path.join(reportsDir, `${symbol}_report.html`), html, "utf8");

  return { metrics: m };
}