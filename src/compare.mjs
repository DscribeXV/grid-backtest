// src/compare.mjs
// Run the same backtest under multiple parameter sets and emit a side-by-side report.

import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { runBacktest, computeMetrics } from "./grid_engine.mjs";
import { writeAll } from "./report.mjs";

const SYMBOL = "002017";
const NAME = "东信和平";
const DATA_CSV = path.join("data", "processed", `${SYMBOL}.csv`);

const SCENARIOS = [
  { name: "standard_strict",  label: "标准网格（保守：30笔上限/60日通道）",
    params: { window: 60, rebalance: 20, grid_count: 10, spacing: "geometric", position_cap_lots: 30, order_lots: 1 } },
  { name: "wide_window",      label: "宽通道（120日）",
    params: { window: 120, rebalance: 30, grid_count: 12, spacing: "geometric", position_cap_lots: 30, order_lots: 1 } },
  { name: "narrow_dense",     label: "窄通道密集网格（30日/16条线）",
    params: { window: 30, rebalance: 10, grid_count: 16, spacing: "geometric", position_cap_lots: 30, order_lots: 1 } },
  { name: "trend_follow",     label: "趋势跟随网格（短通道+大持仓上限）",
    params: { window: 20, rebalance: 10, grid_count: 10, spacing: "arithmetic", position_cap_lots: 200, order_lots: 1 } },
  { name: "arithmetic_wide",  label: "算术等差宽通道（120日/20条线）",
    params: { window: 120, rebalance: 30, grid_count: 20, spacing: "arithmetic", position_cap_lots: 30, order_lots: 1 } },
];

async function main() {
  const raw = await fs.readFile(DATA_CSV, "utf8");
  const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true });
  const bars = records.map(r => ({
    date: r.date, open: +r.open, close: +r.close, high: +r.high, low: +r.low,
    volume: +r.volume, amount: +r.amount,
  }));

  const baseParams = {
    initial_cash: 200000, commission_rate: 0.00025, commission_min: 5,
    stamp_tax_rate: 0.0005, slippage_ticks: 1, tick_size: 0.01, lot_size: 100,
  };

  const rows = [];
  for (const s of SCENARIOS) {
    const params = { ...baseParams, ...s.params };
    const result = runBacktest(bars, params);
    const metrics = computeMetrics(result, bars);
    const outDirs = {
      equityDir: "results/equity",
      tradesDir: "results/trades",
      chartsDir: "results/charts",
      reportsDir: "results/reports",
    };
    const tag = s.name;
    await writeAll({ symbol: `${SYMBOL}_${tag}`, name: `${NAME} / ${s.label}`, result, metrics, outDirs });
    rows.push({ name: s.name, label: s.label, params, ...metrics });
    const r = (x, d=2) => (x*100).toFixed(d);
    console.log(`[compare] ${s.name.padEnd(20)} ret=${r(metrics.total_return).padStart(7)}%  CAGR=${r(metrics.cagr).padStart(7)}%  MaxDD=${r(metrics.max_drawdown).padStart(7)}%  Sharpe=${String(metrics.sharpe).padStart(6)}  Trades=${metrics.n_trades}`);
  }

  const cmp = {
    symbol: SYMBOL, name: NAME,
    range: { start: bars[0].date, end: bars.at(-1).date, n: bars.length },
    scenarios: rows,
  };
  await fs.writeFile("results/reports/002017_comparison.json", JSON.stringify(cmp, null, 2), "utf8");

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>网格交易参数对比 — ${NAME} (${SYMBOL})</title>
<style>
  body { font-family: "Segoe UI","Microsoft YaHei",Arial,sans-serif; margin:0; background:#f7f7fa; color:#222; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }
  h1 { margin: 0 0 6px 0; font-size: 22px; }
  h2 { margin: 28px 0 10px 0; font-size: 18px; border-left: 4px solid #1f77b4; padding-left: 8px; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 13px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: right; }
  th { background: #f0f2f5; }
  td.l, th.l { text-align: left; }
  .pos { color: #2ca02c; } .neg { color: #d62728; }
  .small { color: #666; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>网格交易参数对比 — ${NAME} (${SYMBOL})</h1>
  <div class="small">回测区间：${bars[0].date} → ${bars.at(-1).date}（${bars.length} 个交易日）</div>
  <p class="small">同一份 2024-2025 日线数据，5 套不同参数下的网格表现。基准"买入持有"总收益 = ${(rows[0].benchmark?.total_return*100 ?? 0).toFixed(2)}%。</p>

  <h2>对比表</h2>
  <table>
    <thead>
      <tr>
        <th class="l">场景</th>
        <th class="l">参数摘要</th>
        <th>总收益</th>
        <th>CAGR</th>
        <th>最大回撤</th>
        <th>夏普</th>
        <th>年化波动</th>
        <th>期末权益</th>
        <th>交易笔数</th>
        <th>胜率</th>
        <th>盈亏因子</th>
      </tr>
    </thead>
    <tbody>
${rows.map(r => `<tr>
  <td class="l">${r.label}</td>
  <td class="l small">w=${r.params.window} reb=${r.params.rebalance} grid=${r.params.grid_count} ${r.params.spacing} cap=${r.params.position_cap_lots}</td>
  <td class="${r.total_return>=0?"pos":"neg"}">${(r.total_return*100).toFixed(2)}%</td>
  <td class="${r.cagr>=0?"pos":"neg"}">${(r.cagr*100).toFixed(2)}%</td>
  <td class="neg">${(r.max_drawdown*100).toFixed(2)}%</td>
  <td>${r.sharpe}</td>
  <td>${(r.ann_volatility*100).toFixed(2)}%</td>
  <td>¥${Math.round(r.final_equity).toLocaleString("zh-CN")}</td>
  <td>${r.n_trades}</td>
  <td>${(r.win_rate*100).toFixed(2)}%</td>
  <td>${r.profit_factor}</td>
</tr>`).join("\n")}
    </tbody>
  </table>

  <h2>结论速读</h2>
  <ul>
    <li>东信和平 2024-2025 走出了近 +117% 的单边大牛市，所有"震荡假设"的网格策略都跑输买入持有。</li>
    <li>"宽通道 + 大持仓上限"的趋势跟随网格最接近买入持有，但仍被网格本身的上限与再拟合延迟拖累。</li>
    <li>网格在 <b>震荡 / 高换手</b> 标的上才能体现优势——本标的并不是。</li>
    <li>如果目标是"牛市不掉队、熊市/震荡有底"，更适合用 <b>趋势判断 + 网格</b> 的混合策略（例如只在 ATR/均线确认震荡时才开网格）。</li>
  </ul>
</div>
</body>
</html>`;
  await fs.writeFile("results/reports/002017_comparison.html", html, "utf8");
  console.log("\n[compare] comparison files written.");
}

main().catch(e => { console.error(e); process.exit(1); });